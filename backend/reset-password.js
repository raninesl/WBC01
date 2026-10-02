import mongoose from 'mongoose';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import User from './models/User.js';

dotenv.config();

const uri = process.env.MONGO_URI;

const username = process.argv[2];
const newPassword = process.argv[3];

if (!username || !newPassword) {
  console.log('Usage: node reset-password.js <username> <new_password>');
  process.exit(1);
}

async function resetPassword() {
  try {
    await mongoose.connect(uri);
    console.log('Connected to DB');

    const user = await User.findOne({ username });
    if (!user) {
      console.log('User not found');
    } else {
      const hash = await bcrypt.hash(newPassword, 10);
      user.passwordHash = hash;
      await user.save();
      console.log(`Password for ${username} reset to ${newPassword}`);
    }

    await mongoose.disconnect();
  } catch (e) {
    console.error(e);
  }
}

resetPassword();
