const { DataTypes } = require('sequelize');
const sequelize = require('../connection');

const Room = sequelize.define('Room', {
    id: {
        type: DataTypes.STRING,
        primaryKey: true, // Room ID is the custom string generated/used in URL
        allowNull: false
    },
    name: {
        type: DataTypes.STRING,
        allowNull: true
    },
    ownerId: {
        type: DataTypes.INTEGER,
        allowNull: true, // Could be null if created anonymously or if we allow that
        references: {
            model: 'Users',
            key: 'id'
        }
    }
});

module.exports = Room;
