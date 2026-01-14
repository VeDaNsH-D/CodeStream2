const sequelize = require('./connection');
const User = require('./models/User');
const Room = require('./models/Room');
const File = require('./models/File');
const Message = require('./models/Message');

// Associations
User.hasMany(Room, { foreignKey: 'ownerId' });
Room.belongsTo(User, { foreignKey: 'ownerId' });

Room.hasMany(File, { foreignKey: 'roomId', onDelete: 'CASCADE' });
File.belongsTo(Room, { foreignKey: 'roomId' });

Room.hasMany(Message, { foreignKey: 'roomId', onDelete: 'CASCADE' });
Message.belongsTo(Room, { foreignKey: 'roomId' });

User.hasMany(Message, { foreignKey: 'userId' });
Message.belongsTo(User, { foreignKey: 'userId' });

// Many-to-Many for Room Membership (History)
User.belongsToMany(Room, { through: 'RoomMembers', as: 'joinedRooms' });
Room.belongsToMany(User, { through: 'RoomMembers', as: 'members' });

const initDB = async () => {
    try {
        await sequelize.authenticate();
        console.log('Database connection has been established successfully.');
        await sequelize.sync({ alter: true }); // Automatically creates tables or updates them
        console.log('Database synchronized.');
    } catch (error) {
        console.error('Unable to connect to the database:', error);
    }
};

module.exports = {
    sequelize,
    User,
    Room,
    File,
    Message,
    initDB
};
