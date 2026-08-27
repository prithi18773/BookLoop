const cron = require('node-cron');
const Book = require('../models/Book');
const { promoteNextInQueue } = require('../controllers/bookController');

// Finds every book with an active "notified" holder whose window has passed,
// marks that entry expired, and promotes the next person in line (state
// machine transition: notified -> expired, then waiting -> notified).
async function processExpiredReservations() {
  const now = new Date();

  const books = await Book.find({
    status: 'reserved',
    queue: {
      $elemMatch: { status: 'notified', expiresAt: { $lt: now } },
    },
  });

  if (books.length === 0) {
    console.log(`[cron] ${now.toISOString()} - no expired reservations found`);
    return;
  }

  for (const book of books) {
    const activeEntry = book.queue.find((e) => e.status === 'notified');
    if (activeEntry && activeEntry.expiresAt < now) {
      activeEntry.status = 'expired';
      promoteNextInQueue(book);
      await book.save();
      console.log(`[cron] Expired reservation on "${book.title}" (${book._id}), queue advanced`);
    }
  }
}

function startExpiryCron() {
  const schedule = process.env.CRON_SCHEDULE || '0 * * * *'; // default: every hour
  cron.schedule(schedule, () => {
    processExpiredReservations().catch((err) =>
      console.error('[cron] Error processing expired reservations:', err.message)
    );
  });
  console.log(`[cron] Reservation expiry job scheduled: "${schedule}"`);
}

module.exports = { startExpiryCron, processExpiredReservations };
