const { DataTypes } = require('sequelize');
const sequelize = require('../connection');

const User = sequelize.define('User', {
    username: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true
    },
    email: {
        type: DataTypes.STRING,
        allowNull: true, // Nullable for some social logins if email isn't provided
        unique: true,
        validate: {
            isEmail: true
        }
    },
    password_hash: {
        type: DataTypes.STRING,
        allowNull: true // Null for social login users
    },
    provider: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: 'local' // local, google, github
    },
    provider_id: {
        type: DataTypes.STRING,
        allowNull: true
    }
});

module.exports = User;
