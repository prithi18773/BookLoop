const express = require('express');
const router = express.Router();
const {
  createBook,
  getBooks,
  getBookById,
  reserveBook,
  cancelReservation,
  confirmPickup,
  getQueue,
  rateExchange,
  removeBook,
} = require('../controllers/bookController');
const { protect } = require('../middleware/auth');

// Public: anyone can browse listings
router.get('/', getBooks);
router.get('/:id', getBookById);
router.get('/:id/queue', getQueue);

// Protected: requires a valid access token
router.post('/', protect, createBook);
router.post('/:id/reserve', protect, reserveBook);
router.delete('/:id/reserve', protect, cancelReservation);
router.patch('/:id/confirm', protect, confirmPickup);
router.post('/:id/rate', protect, rateExchange);
router.delete('/:id', protect, removeBook);

module.exports = router;
