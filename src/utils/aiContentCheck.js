/**
 * Converts an image file to base64
 * @param {File} file - The image file to convert
 * @returns {Promise<string>} Base64 string of the image
 */
const convertImageToBase64 = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1]); // Remove data URL prefix
    reader.onerror = (error) => reject(error);
    reader.readAsDataURL(file);
  });
};

/**
 * Validates content using external validation service
 * @param {Object} content - Content to validate
 * @param {string} content.title - Post title
 * @param {string} content.content - Post content
 * @param {File} [content.image] - Optional image file
 * @returns {Promise<Object>} Validation results
 */
export const validateContent = async ({ title, content, image }) => {
  try {
    const payload = {
      prompt: import.meta.env.VITE_AI_MODERATION_PROMPT,
      title,
      content,
    };

    // If image exists, convert to base64 and add to payload
    if (image) {
      const base64Image = await convertImageToBase64(image);
      payload.image = base64Image;
    }

    const response = await fetch(
      "https://simple-calorie-c68468523a43.herokuapp.com/api/validate-content",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      }
    );

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.message || "Content validation failed");
    }

    const result = await response.json();

    // Ensure the response matches our expected format
    if (
      !Object.prototype.hasOwnProperty.call(result, "isValid") ||
      typeof result.isValid !== "boolean"
    ) {
      throw new Error("Invalid response format from validation service");
    }

    return {
      isValid: result.isValid,
      message: result.message || "Content validation completed.",
      details: result.details || {},
    };
  } catch (error) {
    console.error("Error validating content:", error);
    throw new Error(
      error.message || "Content validation failed. Please try again."
    );
  }
};
