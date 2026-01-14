const { DataTypes } = require('sequelize');
const sequelize = require('../connection');

const Message = sequelize.define('Message', {
    roomId: {
        type: DataTypes.STRING,
        allowNull: false,
        references: {
            model: 'Rooms',
            key: 'id'
        }
    },
    userId: {
        type: DataTypes.INTEGER,
        allowNull: true, // Could be null if we allow anonymous chatting, or keep it strict
        references: {
            model: 'Users',
            key: 'id'
        }
    },
    username: {
        type: DataTypes.STRING, // Snapshot of username in case user is deleted/renamed or anonymous
        allowNull: false
    },
    content: {
        type: DataTypes.TEXT,
        allowNull: false
    }
});

module.exports = Message;
