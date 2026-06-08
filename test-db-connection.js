import { getCategories } from './src/db.js';

async function testConnection() {
  console.log('Testing connection to MySQL database...');
  try {
    const categories = await getCategories();
    console.log('Successfully connected!');
    console.log(`Retrieved ${categories.length} categories from categories table.`);
    process.exit(0);
  } catch (error) {
    console.error('Failed to connect to the database:', error);
    process.exit(1);
  }
}

testConnection();
