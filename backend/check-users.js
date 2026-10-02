import mongoose from 'mongoose';
import dotenv from 'dotenv';
import User from './models/User.js';

dotenv.config();

const uri = process.env.MONGO_URI;

async function checkUsers() {
  try {
    await mongoose.connect(uri);
    console.log('Connected to DB');

    const users = await User.find({});
    console.log('Users found:', users.length);
    users.forEach(u => {
        console.log(`- Username: ${u.username}, Email: ${u.email}, Role: ${u.role}, Status: ${u.status}, IsActive: ${u.isActive}, PwdHash: ${u.passwordHash ? 'YES' : 'NO'}`);
    });

    await mongoose.disconnect();
  } catch (e) {
    console.error(e);
  }
}

checkUsers();
