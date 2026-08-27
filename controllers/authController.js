const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const { generateAccessToken, generateRefreshToken } = require('../utils/generateTokens');

// POST /api/auth/register
async function register(req, res) {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ message: 'Name, email, and password are all required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters' });
    }

    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) {
      return res.status(409).json({ message: 'An account with this email already exists' });
    }

    const user = await User.create({ name, email, password });

    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);

    // Store a hash of the refresh token, not the token itself
    const hashedRefresh = await bcrypt.hash(refreshToken, 10);
    user.refreshTokens.push(hashedRefresh);
    await user.save();

    res.status(201).json({
      message: 'Registration successful',
      user: { id: user._id, name: user.name, email: user.email, role: user.role },
      accessToken,
      refreshToken,
    });
  } catch (err) {
    res.status(500).json({ message: 'Registration failed', error: err.message });
  }
}

// POST /api/auth/login
async function login(req, res) {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    const user = await User.findOne({ email: email.toLowerCase() }).select('+password +refreshTokens');
    if (!user) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);

    const hashedRefresh = await bcrypt.hash(refreshToken, 10);
    user.refreshTokens.push(hashedRefresh);
    // Keep at most 5 concurrent sessions per user to prevent unbounded growth
    if (user.refreshTokens.length > 5) {
      user.refreshTokens = user.refreshTokens.slice(-5);
    }
    await user.save();

    res.status(200).json({
      message: 'Login successful',
      user: { id: user._id, name: user.name, email: user.email, role: user.role },
      accessToken,
      refreshToken,
    });
  } catch (err) {
    res.status(500).json({ message: 'Login failed', error: err.message });
  }
}

// POST /api/auth/refresh
// Exchanges a valid refresh token for a new access token (and rotates the refresh token)
async function refresh(req, res) {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      return res.status(400).json({ message: 'Refresh token is required' });
    }

    let decoded;
    try {
      decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    } catch (err) {
      return res.status(401).json({ message: 'Invalid or expired refresh token' });
    }

    const user = await User.findById(decoded.id).select('+refreshTokens');
    if (!user) {
      return res.status(401).json({ message: 'User no longer exists' });
    }

    // Check the presented token against the stored hashes
    let matchedIndex = -1;
    for (let i = 0; i < user.refreshTokens.length; i++) {
      const isMatch = await bcrypt.compare(refreshToken, user.refreshTokens[i]);
      if (isMatch) {
        matchedIndex = i;
        break;
      }
    }

    if (matchedIndex === -1) {
      return res.status(401).json({ message: 'Refresh token not recognized, please log in again' });
    }

    // Rotate: remove old refresh token, issue a new one
    const newAccessToken = generateAccessToken(user);
    const newRefreshToken = generateRefreshToken(user);
    const newHashed = await bcrypt.hash(newRefreshToken, 10);

    user.refreshTokens.splice(matchedIndex, 1, newHashed);
    await user.save();

    res.status(200).json({ accessToken: newAccessToken, refreshToken: newRefreshToken });
  } catch (err) {
    res.status(500).json({ message: 'Could not refresh token', error: err.message });
  }
}

// POST /api/auth/logout
async function logout(req, res) {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      return res.status(400).json({ message: 'Refresh token is required to log out' });
    }

    const user = await User.findById(req.user._id).select('+refreshTokens');
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Remove the matching refresh token so it can't be used again
    const remaining = [];
    for (const hashed of user.refreshTokens) {
      const isMatch = await bcrypt.compare(refreshToken, hashed);
      if (!isMatch) remaining.push(hashed);
    }
    user.refreshTokens = remaining;
    await user.save();

    res.status(200).json({ message: 'Logged out successfully' });
  } catch (err) {
    res.status(500).json({ message: 'Logout failed', error: err.message });
  }
}

// GET /api/auth/me
async function getMe(req, res) {
  res.status(200).json({
    id: req.user._id,
    name: req.user.name,
    email: req.user.email,
    role: req.user.role,
    averageRating: req.user.averageRating,
  });
}

module.exports = { register, login, refresh, logout, getMe };
