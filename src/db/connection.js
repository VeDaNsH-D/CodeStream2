const { Sequelize } = require('sequelize');
const path = require('path');

// Use DATABASE_URL environment variable if available (Render), otherwise use local SQLite file
const databaseUrl = process.env.DATABASE_URL;

let sequelize;

if (databaseUrl) {
    sequelize = new Sequelize(databaseUrl, {
        dialect: 'postgres',
        protocol: 'postgres',
        dialectOptions: {
            ssl: {
                require: true,
                rejectUnauthorized: false // Required for Render's self-signed certificates
            }
        },
        logging: false
    });
} else {
    sequelize = new Sequelize({
        dialect: 'sqlite',
        storage: path.join(__dirname, '../../database.sqlite'),
        logging: false
    });
}

module.exports = sequelize;
