const { DataTypes } = require('sequelize');
const sequelize = require('../connection');

const File = sequelize.define('File', {
    roomId: {
        type: DataTypes.STRING,
        allowNull: false,
        references: {
            model: 'Rooms',
            key: 'id'
        }
    },
    filename: {
        type: DataTypes.STRING,
        allowNull: false
    },
    content: {
        type: DataTypes.TEXT,
        allowNull: false,
        defaultValue: ''
    }
}, {
    indexes: [
        {
            unique: true,
            fields: ['roomId', 'filename']
        }
    ]
});

module.exports = File;
