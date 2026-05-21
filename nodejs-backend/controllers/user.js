const User = require('../Module/user/userDetails'); // Adjust the path as needed

// Controller for User operations
const UserController = {

    // Create a new user
    createUser: async (req, res) => {
        try {
            const userData = req.body;
            const newUser = new User(userData);
            await newUser.validate(); // Validate before saving
            await newUser.save();
            res.status(201).json({ message: 'User created successfully', data: newUser });
        } catch (error) {
            res.status(400).json({ message: 'Error creating user', error: error.message });
        }
    },

    // Get user by ID
    getUserById: async (req, res) => {
        try {
            const userId = req.params.id;
            const user = await User.findById(userId);
            if (!user) {
                return res.status(404).json({ message: 'User not found' });
            }
            res.status(200).json({ message: 'User retrieved successfully', data: user });
        } catch (error) {
            res.status(400).json({ message: 'Error retrieving user', error: error.message });
        }
    },

    // Update user by ID
    updateUserById: async (req, res) => {
        try {
            const userId = req.params.id;
            const updatedData = req.body;
            const updatedUser = await User.findByIdAndUpdate(userId, updatedData, { new: true });
            if (!updatedUser) {
                return res.status(404).json({ message: 'User not found' });
            }
            res.status(200).json({ message: 'User updated successfully', data: updatedUser });
        } catch (error) {
            res.status(400).json({ message: 'Error updating user', error: error.message });
        }
    },

    // Delete user by ID
    deleteUserById: async (req, res) => {
        try {
            const userId = req.params.id;
            const deletedUser = await User.findByIdAndDelete(userId);
            if (!deletedUser) {
                return res.status(404).json({ message: 'User not found' });
            }
            res.status(200).json({ message: 'User deleted successfully', data: deletedUser });
        } catch (error) {
            res.status(400).json({ message: 'Error deleting user', error: error.message });
        }
    },

    // Get all users
    getAllUsers: async (req, res) => {
        try {
            const users = await User.find();
            res.status(200).json({ message: 'Users retrieved successfully', data: users });
        } catch (error) {
            res.status(400).json({ message: 'Error retrieving users', error: error.message });
        }
    }
};

module.exports = UserController;
