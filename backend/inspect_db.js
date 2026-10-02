import "dotenv/config";
import mongoose from "mongoose";

async function inspect() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error("❌ MONGO_URI is missing in .env");
    process.exit(1);
  }

  try {
    console.log("Connecting to MongoDB...");
    await mongoose.connect(uri);
    console.log("✅ Connected successfully.\n");

    const collections = await mongoose.connection.db.listCollections().toArray();
    
    if (collections.length === 0) {
      console.log("No collections found in the database.");
    } else {
      console.log("📊 Database Collections & Counts:");
      console.log("---------------------------------");
      
      for (const col of collections) {
        const count = await mongoose.connection.db.collection(col.name).countDocuments();
        console.log(`- ${col.name}: ${count} documents`);
      }
      console.log("---------------------------------");
    }

  } catch (err) {
    console.error("❌ Error connecting to database:", err);
  } finally {
    await mongoose.disconnect();
    console.log("\nDisconnected.");
    process.exit(0);
  }
}

inspect();
