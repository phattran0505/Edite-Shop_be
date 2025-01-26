import mongoose from "mongoose";

export const CitiesSchema = new mongoose.Schema({
  country: {
    type: String,
    required: true,
  },
  cities: [
    {
      name: {
        type: String,
        required: true,
      },
      zipCode: {
        type: String,
        required: true,
      },
    },
  ],
  shippingFees: {
    type:Number,
    required: true,
  },
});

export const CitiesModel = mongoose.model("cities", CitiesSchema);

export default CitiesModel;
