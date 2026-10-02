// backend/config/db.js
import mongoose from "mongoose";

export default async function connectDB() {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error("MONGO_URI manquant dans .env");

  await mongoose.connect(uri);
  console.log("✅ MongoDB connecté");
}
