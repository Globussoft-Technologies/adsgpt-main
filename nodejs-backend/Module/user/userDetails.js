const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const MembershipTypeSchema = new Schema({
    trial: { type: String,  required: [true, 'trial is required'] },
    recurring: { type: String,  required: [true, 'recurring is required']}
});

const UserDetailsSchema = new Schema({
    firstName: { type: String, required: [true, 'First name is required'] },
    lastName: { type: String, required: [true, 'Last name is required'] },
    username: { type: String, required: [true, 'Username is required'], unique: [true, 'Username must be unique'] },
    emailAddress: { type: String, required: [true, 'Email address is required'], unique: [true, 'Email address must be unique'] },
    password: { type: String, required: [true, 'Password is required'] },
    confirmPassword: { type: String, required: [true, 'Confirm password is required'] },
    phoneNumber: { type: String, required: [true, 'Phone number is required'] },
    isWhatsAppNumber: { type: Boolean, default: false },
    skypeID: { type: String, default: "" },
    telegramID: { type: String, default: "" }
  });

const AddressInformationSchema = new Schema({
  address: { type: String, required: false },
  city: { type: String, required: false },
  country: { type: String, required: [true, 'Country is required'] },
  state: { type: String, required: false },
  zipCode: { type: String, required: false }
});

const PaymentProcessSchema = new Schema({
  couponCode: { type: String, default: "" },
  paymentSystem: { type: String, enum: ['PayPal', 'Credit Card'], required: [true, 'Payment system is required'] }
});

const TermsAndConditionsSchema = new Schema({
    agreedToTerms: { type: Boolean, default: false, required: [true, 'Must agree to terms'] },
    receiveProductUpdates: { type: Boolean, default: false },
    notARobot: { type: Boolean, default: false }
});

const UserSchema = new Schema({
  membershipType: { type: MembershipTypeSchema, required: true },
  userDetails: { type: UserDetailsSchema, required: true , unique: true},
  addressInformation: { type: AddressInformationSchema, required: true },
  paymentProcess: { type: PaymentProcessSchema, required: true },
  termsAndConditions: { type: TermsAndConditionsSchema, required: true }
});

module.exports = mongoose.model('User', UserSchema);
