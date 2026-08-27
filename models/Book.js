const mongoose = require('mongoose');

// One entry in a book's reservation queue.
// status flow (state machine):
//   waiting   -> person is in line, not yet their turn
//   notified  -> it's their turn, they have until expiresAt to confirm pickup
//   confirmed -> they picked up the book, exchange complete
//   expired   -> they missed their window, bumped out automatically by cron
//   cancelled -> they voluntarily left the queue
const reservationSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    status: {
      type: String,
      enum: ['waiting', 'notified', 'confirmed', 'expired', 'cancelled'],
      default: 'waiting',
    },
    requestedAt: {
      type: Date,
      default: Date.now,
    },
    notifiedAt: {
      type: Date,
      default: null,
    },
    expiresAt: {
      type: Date,
      default: null,
    },
  },
  { _id: true }
);

const bookSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, 'Title is required'],
      trim: true,
    },
    subject: {
      type: String,
      required: [true, 'Subject is required'],
      trim: true,
    },
    author: {
      type: String,
      trim: true,
    },
    condition: {
      type: String,
      enum: ['new', 'good', 'fair', 'worn'],
      default: 'good',
    },
    description: {
      type: String,
      trim: true,
      maxlength: 1000,
    },
    price: {
      type: Number,
      default: 0, // 0 means "free"
      min: 0,
    },
    postedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    status: {
      type: String,
      enum: ['available', 'reserved', 'exchanged', 'removed'],
      default: 'available',
    },
    queue: {
      type: [reservationSchema],
      default: [],
    },
  },
  { timestamps: true }
);

// Helpful index for common filters
bookSchema.index({ subject: 1, status: 1 });

module.exports = mongoose.model('Book', bookSchema);
