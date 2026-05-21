 
 export const PromptInageAnalizing = `Analyze the given image in detail to extract key visual elements. The goal is to understand its style, content, and unique features to generate a visually similar image. Break down the image into the following structured categories:

 ### **1️⃣ General Image Analysis**  
 - **Objects & Subjects:** Identify the main elements in the image.  
 - **Composition & Perspective:** Camera angle, focus, and depth of field.  
 - **Color Palette:** Dominant and secondary colors.  
 - **Lighting & Shadows:** Brightness, contrast, and light sources.  
 - **Mood & Atmosphere:** Emotions or vibes conveyed by the image.  
 - **Texture & Details:** Any noticeable textures or patterns.  
 - **Additional Notes:** Anything unique that should be retained in a similar image.  
 
 ### **2️⃣ AI Art / Digital Painting Analysis**  
 - **Art Style:** (e.g., impressionist, photorealistic, anime, 3D render)  
 - **Brushwork & Texture:** (if applicable, in paintings)  
 - **Composition & Perspective:** (e.g., close-up shot, panoramic, first-person)  
 - **Color Palette & Contrast:** Major color schemes and tonal balance.  
 - **Mood & Theme:** The feeling or atmosphere conveyed by the image.  
 - **Key Features:** Any artistic elements that define this image’s uniqueness.  
 
 ### **3️⃣ Product / Object-Based Image Analysis**  
 - **Primary Object:** What is the main item in the image?  
 - **Shape & Size:** Describe dimensions, proportions, and unique contours.  
 - **Material & Texture:** Glossy, matte, metallic, fabric, plastic, etc.  
 - **Colors & Patterns:** Key color tones and any distinct designs.  
 - **Background & Environment:** What surrounds the object? Is it isolated?  
 - **Lighting & Shadows:** How does light interact with the object?  
 
 ### **4️⃣ Faces / Portraits Analysis**  
 - **Facial Features:** (e.g., sharp jawline, round cheeks, prominent nose)  
 - **Expression & Emotion:** (e.g., serious, joyful, melancholic)  
 - **Hair Type & Style:** (e.g., curly, short bob, sleek long hair)  
 - **Eye Shape & Color:** (e.g., almond-shaped, green with gold flecks)  
 - **Skin Tone & Texture:** (e.g., porcelain, freckled, sun-kissed)  
 - **Clothing & Accessories:** (if applicable)  
 - **Lighting & Shadows:** How does light shape the face?  
 - **Art Style:** Realistic, anime, pixel art, etc.  
 
 ### **5️⃣ Landscapes / Scenes Analysis**  
 - **Geography & Terrain:** Mountains, ocean, forests, cityscape, etc.  
 - **Weather & Lighting:** Sunny, overcast, golden hour, night scene.  
 - **Color Palette:** Warm tones, cool hues, natural saturation.  
 - **Perspective & Depth:** Wide-angle, close-up, aerial, eye-level.  
 - **Textures & Details:** Grass, water reflections, rocky formations.  
 - **Human Presence (if any):** Crowds, solitary figure, no people.  
 
 ### **Final Goal:**  
 Provide a structured, detailed breakdown so the AI can generate a **visually similar image** while retaining essential elements.
 `