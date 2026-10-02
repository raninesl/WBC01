
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import User from './models/User.js';

dotenv.config();

const uri = process.env.MONGO_URI;

async function checkAndCreateAdmin() {
  try {
    await mongoose.connect(uri);
    console.log('Connected to DB');

    const admin = await User.findOne({ role: 'ADMIN' });

    if (admin) {
      console.log('Admin user found:');
      console.log(`- Username: ${admin.username}`);
      console.log(`- Email: ${admin.email}`);
      
      // Reset password to ensure access
      const passwordHash = await bcrypt.hash('wessup2026', 10);
      admin.passwordHash = passwordHash;
      await admin.save();
      console.log('Password reset to: wessup2026');
    } else {
      console.log('No ADMIN user found. Creating default admin...');
      
      const passwordHash = await bcrypt.hash('admin123', 10);
      
      const newAdmin = await User.create({
        username: 'admin',
        email: 'admin@wessup.local',
        passwordHash,
        role: 'ADMIN',
        fullName: 'Administrateur',
        status: 'active',
        isActive: true,
        emailVerified: true
      });
      
      console.log('Admin created successfully:');
      console.log(`- Username: ${newAdmin.username}`);
      console.log(`- Email: ${newAdmin.email}`);
      console.log(`- Password: admin123`);
    }

    await mongoose.disconnect();
  } catch (e) {
    console.error(e);
  }
}

checkAndCreateAdmin();
