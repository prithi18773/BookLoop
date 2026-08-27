const Book = require('../models/Book');
const User = require('../models/User');

const EXPIRY_HOURS = parseFloat(process.env.RESERVATION_EXPIRY_HOURS || '48');

function getExpiryDate() {
  return new Date(Date.now() + EXPIRY_HOURS * 60 * 60 * 1000);
}

// POST /api/books
async function createBook(req, res) {
  try {
    const { title, subject, author, condition, description, price } = req.body;
    if (!title || !subject) {
      return res.status(400).json({ message: 'Title and subject are required' });
    }

    const book = await Book.create({
      title,
      subject,
      author,
      condition,
      description,
      price: price || 0,
      postedBy: req.user._id,
    });

    res.status(201).json(book);
  } catch (err) {
    res.status(500).json({ message: 'Failed to create listing', error: err.message });
  }
}

// GET /api/books?subject=&status=&search=
async function getBooks(req, res) {
  try {
    const { subject, status, search } = req.query;
    const filter = {};

    if (subject) filter.subject = new RegExp(subject, 'i');
    if (status) filter.status = status;
    else filter.status = { $ne: 'removed' }; // hide removed listings by default
    if (search) filter.title = new RegExp(search, 'i');

    const books = await Book.find(filter)
      .populate('postedBy', 'name averageRating')
      .sort({ createdAt: -1 });

    res.status(200).json(books);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch listings', error: err.message });
  }
}

// GET /api/books/:id
async function getBookById(req, res) {
  try {
    const book = await Book.findById(req.params.id)
      .populate('postedBy', 'name averageRating')
      .populate('queue.user', 'name averageRating');

    if (!book || book.status === 'removed') {
      return res.status(404).json({ message: 'Listing not found' });
    }

    res.status(200).json(book);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch listing', error: err.message });
  }
}

// POST /api/books/:id/reserve
// Core queue logic: if nobody currently holds the "turn", this user is notified
// immediately with an expiry window. Otherwise they're added to the waitlist.
async function reserveBook(req, res) {
  try {
    const book = await Book.findById(req.params.id);
    if (!book || book.status === 'removed') {
      return res.status(404).json({ message: 'Listing not found' });
    }
    if (book.status === 'exchanged') {
      return res.status(400).json({ message: 'This book has already been exchanged' });
    }
    if (String(book.postedBy) === String(req.user._id)) {
      return res.status(400).json({ message: 'You cannot reserve your own listing' });
    }

    const alreadyInQueue = book.queue.some(
      (entry) => String(entry.user) === String(req.user._id) && ['waiting', 'notified'].includes(entry.status)
    );
    if (alreadyInQueue) {
      return res.status(409).json({ message: 'You are already in the queue for this book' });
    }

    const activeEntry = book.queue.find((entry) => entry.status === 'notified');

    if (!activeEntry) {
      // Nobody currently holds the turn — this user gets it immediately
      book.queue.push({
        user: req.user._id,
        status: 'notified',
        notifiedAt: new Date(),
        expiresAt: getExpiryDate(),
      });
      book.status = 'reserved';
    } else {
      // Someone else is already up — join the waitlist
      book.queue.push({
        user: req.user._id,
        status: 'waiting',
      });
    }

    await book.save();
    res.status(200).json({ message: 'Reservation registered', book });
  } catch (err) {
    res.status(500).json({ message: 'Failed to reserve book', error: err.message });
  }
}

// DELETE /api/books/:id/reserve
// Lets a user voluntarily leave the queue. If they were the active ("notified")
// holder, the next waiting person is promoted automatically.
async function cancelReservation(req, res) {
  try {
    const book = await Book.findById(req.params.id);
    if (!book) return res.status(404).json({ message: 'Listing not found' });

    const entry = book.queue.find(
      (e) => String(e.user) === String(req.user._id) && ['waiting', 'notified'].includes(e.status)
    );
    if (!entry) {
      return res.status(404).json({ message: 'You do not have an active reservation on this book' });
    }

    const wasActiveHolder = entry.status === 'notified';
    entry.status = 'cancelled';

    if (wasActiveHolder) {
      promoteNextInQueue(book);
    }

    await book.save();
    res.status(200).json({ message: 'Reservation cancelled', book });
  } catch (err) {
    res.status(500).json({ message: 'Failed to cancel reservation', error: err.message });
  }
}

// PATCH /api/books/:id/confirm
// Only the person currently holding the "notified" turn can confirm pickup
async function confirmPickup(req, res) {
  try {
    const book = await Book.findById(req.params.id);
    if (!book) return res.status(404).json({ message: 'Listing not found' });

    const entry = book.queue.find(
      (e) => String(e.user) === String(req.user._id) && e.status === 'notified'
    );
    if (!entry) {
      return res.status(403).json({ message: 'It is not your turn to confirm pickup for this book' });
    }

    entry.status = 'confirmed';
    book.status = 'exchanged';
    await book.save();

    res.status(200).json({ message: 'Pickup confirmed, exchange complete', book });
  } catch (err) {
    res.status(500).json({ message: 'Failed to confirm pickup', error: err.message });
  }
}

// GET /api/books/:id/queue
async function getQueue(req, res) {
  try {
    const book = await Book.findById(req.params.id).populate('queue.user', 'name');
    if (!book) return res.status(404).json({ message: 'Listing not found' });

    const activeQueue = book.queue.filter((e) => ['waiting', 'notified'].includes(e.status));
    res.status(200).json({ queue: activeQueue, length: activeQueue.length });
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch queue', error: err.message });
  }
}

// POST /api/books/:id/rate  { stars }
// Rate the other party after a completed exchange (poster rates the person who
// confirmed pickup, or vice versa)
async function rateExchange(req, res) {
  try {
    const { stars } = req.body;
    if (!stars || stars < 1 || stars > 5) {
      return res.status(400).json({ message: 'Stars must be a number between 1 and 5' });
    }

    const book = await Book.findById(req.params.id);
    if (!book || book.status !== 'exchanged') {
      return res.status(400).json({ message: 'This book has not been exchanged yet' });
    }

    const confirmedEntry = book.queue.find((e) => e.status === 'confirmed');
    if (!confirmedEntry) {
      return res.status(400).json({ message: 'No confirmed recipient found for this book' });
    }

    const posterId = String(book.postedBy);
    const recipientId = String(confirmedEntry.user);
    const requesterId = String(req.user._id);

    let targetUserId;
    if (requesterId === posterId) {
      targetUserId = recipientId; // poster rates the person who picked up the book
    } else if (requesterId === recipientId) {
      targetUserId = posterId; // recipient rates the poster
    } else {
      return res.status(403).json({ message: 'Only the two parties in this exchange can rate each other' });
    }

    await User.findByIdAndUpdate(targetUserId, {
      $inc: { ratingSum: stars, ratingCount: 1 },
    });

    res.status(200).json({ message: 'Rating submitted' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to submit rating', error: err.message });
  }
}

// DELETE /api/books/:id  (owner or admin only)
async function removeBook(req, res) {
  try {
    const book = await Book.findById(req.params.id);
    if (!book) return res.status(404).json({ message: 'Listing not found' });

    const isOwner = String(book.postedBy) === String(req.user._id);
    if (!isOwner && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Not authorized to remove this listing' });
    }

    book.status = 'removed';
    await book.save();
    res.status(200).json({ message: 'Listing removed' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to remove listing', error: err.message });
  }
}

// Helper (also used by the cron job) — promotes the next waiting person to
// "notified" and gives them a fresh expiry window. If nobody is waiting, the
// book goes back to "available".
function promoteNextInQueue(book) {
  const nextWaiting = book.queue.find((e) => e.status === 'waiting');
  if (nextWaiting) {
    nextWaiting.status = 'notified';
    nextWaiting.notifiedAt = new Date();
    nextWaiting.expiresAt = getExpiryDate();
    book.status = 'reserved';
  } else {
    book.status = 'available';
  }
}

module.exports = {
  createBook,
  getBooks,
  getBookById,
  reserveBook,
  cancelReservation,
  confirmPickup,
  getQueue,
  rateExchange,
  removeBook,
  promoteNextInQueue, // exported for the cron job
  getExpiryDate,
};
