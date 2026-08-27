// Catches anything not already handled inside a controller's try/catch,
// plus Mongoose validation/cast errors, and returns a consistent shape.
function errorHandler(err, req, res, next) {
  console.error(err.stack);

  if (err.name === 'ValidationError') {
    const messages = Object.values(err.errors).map((e) => e.message);
    return res.status(400).json({ message: 'Validation failed', errors: messages });
  }

  if (err.name === 'CastError') {
    return res.status(400).json({ message: `Invalid ${err.path}: ${err.value}` });
  }

  if (err.code === 11000) {
    return res.status(409).json({ message: 'Duplicate value', field: Object.keys(err.keyValue)[0] });
  }

  res.status(err.statusCode || 500).json({ message: err.message || 'Internal server error' });
}

function notFound(req, res) {
  res.status(404).json({ message: `Route not found: ${req.method} ${req.originalUrl}` });
}

module.exports = { errorHandler, notFound };
