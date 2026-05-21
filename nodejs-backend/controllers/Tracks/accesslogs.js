const fs = require('fs');
const path = require('path');
const adsCopyChats = require("../../Module/Track/accessRoutesShema");

const getDeviceModel = (screenWidth, screenHeight) => {
  // Load the device data from the JSON file
  const deviceData = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '../../utils/data/deviceModels.json'), 'utf8')
  );

  // Try to find a matching device based on the screen dimensions
  const device = deviceData.find(
    (device) => device.width === screenWidth && device.height === screenHeight
  );

  // Return the model or 'Unknown Device' if no match found
  return device ? device.model : 'Unknown Device';
};

const saveRoute = async (req, res) => {

   
  const { user_id, userName, route, device, timestamp,deviceType } = req.body;

  if (!user_id || !userName || !route) {
    return res.status(400).json({ message: "Missing required fields" });
  }

  const todayDate = new Date().toISOString().split("T")[0]; // 'YYYY-MM-DD'

  try {
    // Get the device model based on screen width and height
    const deviceModel = getDeviceModel(device.screenWidth, device.screenHeight);

    // Find the document for the user
    let userRoute = await adsCopyChats.findOne({ user_id });

    if (!userRoute) {
      // If no document exists, create one
      userRoute = new adsCopyChats({
        user_id,
        userName,
        routes: [
          {
            date: todayDate,
            paths: [
              {
                route,
                timestamp: new Date(),
                device: {
                  ...device,
                  deviceModel,
                },
              },
            ],
          },
        ],
      });
    } else {
      // Check if today's date exists in the user's routes
      const todayRoutes = userRoute.routes.find((entry) => entry.date === todayDate);

      if (todayRoutes) {
        // If the date exists, append the new route to today's paths
        todayRoutes.paths.push({
          route,
          timestamp: new Date(),
          device: {
            ...device,
            deviceModel,
          },
        });
      } else {
        // If the date does not exist, add a new date entry
        userRoute.routes.push({
          date: todayDate,
          paths: [
            {
              route,
              timestamp: new Date(),
              device: {
                ...device,
                deviceModel,
              },
            },
          ],
        });
      }
    }

    // Save changes to the database
    await userRoute.save();
    res.status(200).json({ message: "Route saved successfully", data: userRoute });
  } catch (error) {
    console.error("Error saving route:", error);
    res.status(500).json({ message: "Error saving route" });
  }
};
// READ
const getRoutes = async (req, res) => {
   
  
    const { user_id } = req.params;
    if (!user_id) {
      return res.status(400).json({ message: "User ID is required" });
    }
  
    try {
      const userRoutes = await adsCopyChats.findOne({ user_id });
      if (!userRoutes) {
        return res.status(404).json({ message: "Access Routes not found" });
      }
      res.status(200).json({ message: "Access Routes retrieved successfully", data: userRoutes });
    } catch (error) {
      console.error("Error fetching routes:", error);
      res.status(500).json({ message: "Error fetching routes" });
    }
  };
  
 
  
  // DELETE
  const deleteRoute = async (req, res) => {

    const { user_id, routeId } = req.body;
  
    if (!user_id || !routeId) {
      return res.status(400).json({ message: "Missing required fields" });
    }
  
    try {
      const userRoute = await adsCopyChats.findOne({ user_id });
      if (!userRoute) {
        return res.status(404).json({ message: "User not found" });
      }
  
      userRoute.routes.forEach((dateEntry) => {
        dateEntry.paths = dateEntry.paths.filter(
          (path) => path._id.toString() !== routeId
        );
      });
  
      await userRoute.save();
      res.status(200).json({ message: "Route deleted successfully" });
    } catch (error) {
      console.error("Error deleting route:", error);
      res.status(500).json({ message: "Error deleting route" });
    }
  };
  
  module.exports = { saveRoute, getRoutes, deleteRoute };
