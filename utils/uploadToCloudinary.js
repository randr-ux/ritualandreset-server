import cloudinary from "../config/cloudinary.js";

const uploadToCloudinary = async (file, folder) => {
  const options = {
    use_filename: true,
    unique_filename: false,
    overwrite: true,
    folder,
  };

  try {
    const dataURI = `data:${file.mimetype};base64,${file.buffer.toString(
      "base64",
    )}`;

    const result = await cloudinary.uploader.upload(dataURI, options);

    return {
      url: result.secure_url,
      public_id: result.public_id,
    };
  } catch (error) {
    console.error(error);
    throw error;
  }
};

export const uploadTestImageToCloudinary = async (file) => {
  return uploadToCloudinary(file, "ile-ire-test");
};

export const uploadProductImageToCloudinary = async (file) => {
  return uploadToCloudinary(file, "products");
};

export const uploadBlogImageToCloudinary = async (file) => {
  return uploadToCloudinary(file, "blogs");
};