import mongoose from 'mongoose';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import User from './models/User.js';

dotenv.config();

const uri = process.env.MONGO_URI;

async function createTestAccounts() {
  try {
    await mongoose.connect(uri);
    console.log('Connected to DB');

    const accounts = [
      {
        username: 'prof.test',
        email: 'prof@wessup.local',
        password: 'wessup2026',
        role: 'TEACHER',
        fullName: 'Prof Testeur'
      },
      {
        username: 'etu.test',
        email: 'etu@wessup.local',
        password: 'wessup2026',
        role: 'STUDENT',
        fullName: 'Etudiant Testeur'
      }
    ];

    for (const acc of accounts) {
      let user = await User.findOne({ email: acc.email });
      const passwordHash = await bcrypt.hash(acc.password, 10);

      if (user) {
        console.log(`Updating existing user: ${acc.email}`);
        user.username = acc.username;
        user.passwordHash = passwordHash;
        user.role = acc.role;
        user.fullName = acc.fullName;
        user.status = 'active';
        user.isActive = true;
        user.emailVerified = true;
        await user.save();
      } else {
        console.log(`Creating new user: ${acc.email}`);
        await User.create({
          username: acc.username,
          email: acc.email,
          passwordHash,
          role: acc.role,
          fullName: acc.fullName,
          status: 'active',
          isActive: true,
          emailVerified: true
        });
      }
    }

    console.log('Test accounts created/updated successfully!');
    console.log('-------------------------------------------');
    console.log('Teacher: prof@wessup.local / wessup2026');
    console.log('Student: etu@wessup.local  / wessup2026');
    console.log('-------------------------------------------');

    await mongoose.disconnect();
  } catch (e) {
    console.error(e);
  }
}

createTestAccounts();
