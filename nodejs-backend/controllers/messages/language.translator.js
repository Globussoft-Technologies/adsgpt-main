/**
 * Language localization
 *
 * Languages with short code
 *  __________________________________
 * |    LANGUAGE       |     CODE     |
 * |___________________|______________|
 * |    English        |     en       |
 * |    Spanish        |     es       |
 * |    Indonesian     |     idn      |
 * |    French         |     fr       |
 * |    Arabic         |     ar       |
 * |___________________|______________|
 */

//Multilanguage responses for Admin
export let UserMessageNew = {
    USER_CURRENT_PASSWORD_FAIL: {
        en: 'Invalid Current Password.',
    },
    USER_PASSWORD_SUCCESS: {
        en: 'Password Updated Successfully.',
    },
    USER_PASSWORD_FAIL: {
        en: 'Error Updating Password.',
    },
    PASSWORD_RESEND_LIMIT: {
        en: 'Password Re-set mail sent limit reached,Please try next day.'
    },
    PASSWORD_RESEND_MAIL: {
        en: 'Password reset mail sent successfully.'
    },
    USERNAME_EXIST: {
        en: 'UserName already exist, please try with other userName.'
    },
    EMAIL_EXIST: {
        en: 'Email already exist.'
    },
    ADMIN_SIGNUP_SUCCESS: {
        en: 'Admin signup success,Please verify the mail.'
    },
    REVIWER_SIGNUP_SUCCESS: {
        en: 'Reviewer signup success,Please verify the mail.'
    },
    USER_SIGNUP_SUCCESS: {
        en: 'User Sign up Success, Please verify the mail.'
    },
    FAILD_TO_SIGNUP: {
        en: 'Failed to signup'
    },
    EMAIL_NOT_REGISTER: {
        en: 'Email not yet registered.'
    },
    EMAIL_ACTIVATED: {
        en: 'Email already activated!'
    },
    INVALID_TOKEN: {
        en: 'Invalid Activation token!.'
    },
    SESSION_EXPIRED:{
        en:'Session Expired'
    },
    TOKEN_EXPIRED: {
        en: 'Your Token has expired, please re-generated the email verify token.'
    },
    EMAIL_VERIFICATION_FAILED: {
        en: 'Failed to Verify Email !!'
    },
    USER_ACTIVATION_SUCCESS: {
        en: 'User Activated successfully.!'
    },
    USER_ACTIVATION_FAILED: {
        en: 'User Activated Failed.!'
    },
    EMAIL_NOT_EXIST: {
        en: 'Email not exist.'
    },
    FAILED_TO_FETCH_DETAILS: {
        en: 'Error in fetch details.'
    },
    EMAIL_NOT_VERIFIED: {
        en: 'Email not verified.'
    },
    INVALID_EMAIL: {
        en: 'Invalid email.'
    },
    INVALID_PASSWORD: {
        en: 'Invalid password.'
    },
    USER_NOT_EXIST: {
        en: 'User not exist.'
    },
    USER_SUSPENDED: {
        en: 'Account is suspended and not allowed to login.'
    },
    SOMETHING_WENT_WRONG: {
        en: 'Something went wrong'
    },
    PASSWORD_RESET: {
        en: 'Password reset successfully.'
    },
    FAILED_TO_RESET_PWD: {
        en: 'Error while resetting password.'
    },
    VERIFY_MAIL_LIMIT_REACHED: {
        en: 'Verification mail sent limit reached, Please try next day.'
    },
    VERIFY_MAIL_SENT: {
        en: 'Verification mail sent successfully.'
    },
    FAILED_TO_GENERATE_TOKEN: {
        en: 'Failed to generate token.'
    },
    NETWORK_VALIDATION: {
        en: 'Please choose the valid network'
    },
    FAILED_SOCIAL_LOGIN: {
        en: 'Failed to login with social account'
    },
    FAILED_GOOGLE_LOGIN: {
        en: 'Error while adding the Google Account, Invalid Token'
    },
    FAILED_FACEBOOK_LOGIN: {
        en: 'Error social Account Adding, Invalid verification code format'
    },
    FAILED_TWITTER_LOGIN: {
        en: 'Error while adding the Twitter Account, Invalid Token'
    },
    USER_FETCH_SUCCESS: {
        en: 'User fetched successfully'
    },
    USER_FETCH_FAILED: {
        en: 'Failed to fetch user details'
    },
    INVALID_INPUT: {
        en: 'Invalid Input,Provide valid image extension or url for Profile Pic'
    },
    USER_UPDATE_SUCCESS: {
        en: 'Updated Personal Info'
    },
    USER_UPDATE_FAILED: {
        en: 'Failed to update user details'
    },
    USER_ID_NOT_EXIST: {
        en: 'User not found. Please checked Provided UserId'
    },
    USER_SUSPEND_SUCCESS: {
        en: 'User suspended successfully'
    },
    USER_ALREADY_SUSPEND: {
        en: 'User is already suspended'
    },
    USER_RESUMED_SUCCESS: {
        en: 'User resumed successfully'
    },
    USER_ALREADY_RESUMED: {
        en: 'User is already resumed'
    },
    FAILED_USER_STATE_UPDATE: {
        en: 'Error in update user state details'
    },
    ADMIN_UPDATE_SUCCESS: {
        en: 'Admin details updated successfully'
    },
    ADMIN_UPDATE_FAILED: {
        en: 'Failed to update admin details'
    },
    ADMIN_DELETE_SUCCESS: {
        en: 'Admin details deleted successfully'
    },
    ADMIN_DELETE_FAILED: {
        en: 'Failed to delete admin details'
    },
    CANNOT_DELETE_ADMIN: {
        en: `Admin details not found, please check given Id`
    },

};
export let commonMessage = {
    VALIDATION_FAILED: {
        en: 'Validation failed.',
    },
    DATE_MISSING:{
        en: 'startDate/endDate is missing!. please provide both'
    },
    CHAIN_PRESENT: {
        en: 'Chain name already present.',
    },
    CHAIN_CREATED_SUCCESSFULLY: {
        en: 'Chain Created Successfully.',
    },
    CHAIN_CREATION_FAILED: {
        en: 'Chain Creation failed.',
    },
    CHAIN_FETCHED_SUCCESS: {
        en: 'Chain Fetched Successfully.',
    },
    CHAIN_FETCHED_FAILED: {
        en: 'Chain Fetched Failed',
    },
    CHAIN_UPDATED_SUCCESS: {
        en: 'Chain Updated Successfully.',
    },
    CHAIN_UPDATED_FAILED: {
        en: 'Chain Update Failed',
    },
    CHAIN_DELETED_SUCCESS: {
        en: 'Chain deleted Successfully.',
    },
    CHAIN_DELETED_FAILED: {
        en: 'Chain deletion Failed',
    },
    INVALID_OBJECT_ID: {
        en: 'Invalid Chain Object Id ',
    },
    ACCESS_DENIED: {
        en: 'Access Denied for this API'
    },
    CHAIN_SEARCH_SUCCESS: {
        en: 'Chain details search Successfully.',
    },
    CHAIN_SEARCH_FAILED: {
        en: 'Chain details search Failed',
    },
    FOLLOW_UPDATE_FAILED: {
        en: 'Follow update failed.'
    },
    FOLLOW_ADDED_SUCCESS: {
        en: 'followed successfully.'
    },
    UNFOLLOW_ADDED_SUCCESS: {
        en: 'unfollowed successfully.'
    },
    FOLLOWER_NOT_EXIST: {
        en: 'Followers does not exist'
    },
    FOLLOWERS_FETCH_SUCCESS: {
        en: 'Followers fetched successfully.'
    },
    FOLLOWING_FETCH_SUCCESS: {
        en: 'Following list fetched successfully.'
    },
    FOLLOWING_NOT_EXIST: {
        en: 'You are not following anyone.'
    },
    FOLLOWERS_FETCHED_FAILED: {
        en: 'Failed to fetch followers.'
    },
    PROFILE_FETCH_SUCCESS: {
        en: 'Profile Fetched Successfully. '
    },
    PROFILE_FETCH_FAILED: {
        en: 'Profile Fetched Failed. '
    },
    APP_ID_NOT_EXIST: {
        en: 'App Id not found. Please check provided app Id.'
    },
};

export let ApplicationFavouritesMessage = {

    APPLICATION_ID_NOT_EXIST: {
        en: 'Application Id not found. Please check provided application Id.',
    },
    FAVOURITES_ADDED_SUCCESS: {
        en: 'Favourites Added Successfully.',
    },
    FAILED_TO_ADD_FAVOURITES: {
        en: 'Failed to Add favourites for Application',
    },
    FAVOURITES_FETCHED_SUCCESS: {
        en: 'Favourites Fetched Successfully.',
    },
    FAVOURITES_FETCHED_FAILED: {
        en: 'Failed to fetch FAVOURITES',
    },
    FAVOURITES_ALREADY_EXIST: {
        en: 'FAVOURITES already present with this user',
    }
};
export let DraftMessage = {

    APPLICATION_DRAFT_FAILED_TO_SUBMIT: {
        en: 'Failed to submit draft.',
    },
    APPLICATION_DRAFT_SUBMITTED: {
        en: 'Draft Submitted Successfully.',
    },
    DRAFT_DOESNOT_EXIST: {
        en: 'Draft does not exist.',
    },
    DRAFT_FETCH_SUCCESS: {
        en: 'Draft fetch successfully.'
    },
    DRAFT_FETCH_FAILED: {
        en: 'Draft fetch failed.'
    },
    DRAFT_DELETE_FAILED: {
        en: 'Draft delete failed.'
    },
    DRAFT_DELETE_SUCCESS: {
        en: 'Draft delete successfully.'
    }
};
export let RatingMessage = {
    APPLICATION_ID_NOT_EXIST: {
        en: 'Application Id not found. Please check provided application Id.',
    },
    RATING_ID_NOT_EXIST: {
        en: 'Rating Id not found. Please check provided Rating Id.',
    },
    RATING_EXIST: {
        en: 'Rating Already Exist.',
    },
    RATING_ADDED: {
        en: 'Rating Submitted successfully.',
    },
    RATING_CREATION_FAILED: {
        en: 'Failed to submit Rating',
    },
    RATING_FETCHED_SUCCESS: {
        en: 'Rating Fetched Successfully.',
    },
    RATING_FETCHED_FAILED: {
        en: 'Rating Fetched Failed',
    },
    RATING_UPDATED_SUCCESS: {
        en: 'Rating Updated Successfully.',
    },
    RATING_UPDATED_FAILED: {
        en: 'Rating Update Failed',
    },
    RATING_DELETED_SUCCESS: {
        en: 'Rating deleted Successfully.',
    },
    RATING_DELETED_FAILED: {
        en: 'Rating deletion Failed',
    },
    LIKE_ADDED_SUCCESS: {
        en: 'Like Added Successfully.',
    },
    DISLIKE_ADDED_SUCCESS: {
        en: 'Dislike Added Successfully.',
    },
    IMPRESSION_UPDATION_FAILED: {
        en: 'Failed to update impression for rating',
    },
    REVIEW_ID_NOT_EXIST: {
        en: 'Review Id not found. Please check provided review Id.',
    },
    REPLY_ADDED: {
        en: 'Reply Submitted successfully.',
    },
    REPLY_ADDED_FAILED: {
        en: 'Failed to submit Reply.Please check provided review Id.',
    },
    REPLY_EXIST: {
        en: 'Reply Already Exist.',
    },
    REPLY_UPDATED_SUCCESS: {
        en: 'Reply Updated Successfully.',
    },
    REPLY_UPDATED_FAILED: {
        en: 'Reply Update Failed',
    },
    REPLY_DELETED_SUCCESS: {
        en: 'Reply Deleted Successfully.',
    },
    REPLY_DELETED_FAILED: {
        en: 'Reply Delete Failed',
    },
    REPLY_NOT_EXIST: {
        en: 'Reply not found.',
    },
    IMPRESSION_EXIST: {
        en: 'Impression already exist.',
    },
    IMPRESSION_UPDATION_FAILED: {
        en: 'Failed to update impression for reply,Please check replyId',
    },
    IRRELEVANT:{
        en: 'Review has been marked as irrelevant',
    },
    RELEVANT:{
        en: 'Review has been marked as relevant',
    },
};

export let ApplicationLikesMessage = {

    APPLICATION_ID_NOT_EXIST: {
        en: 'Application Id not found. Please check provided application Id.',
    },
    LIKE_ADDED_SUCCESS: {
        en: 'Like Added Successfully.',
    },
    FAILED_TO_ADD_LIKE: {
        en: 'Failed to Add like for Application',
    },
    LIKES_FETCHED_SUCCESS: {
        en: 'likes Fetched Successfully.',
    },
    LIKES_FETCHED_FAILED: {
        en: 'Failed to fetch likes',
    },
    LIKE_ALREADY_EXIST: {
        en: 'Like already present with this user',
    },
    LIKE_DOESNOT_EXIST: {
        en: 'Like doesnot exist',
    },
    DISLIKE_SUCCESS: {
        en: 'Unliked Successfully',
    },
};

export let ApplicationDownloadsMessage = {

    APPLICATION_ID_NOT_EXIST: {
        en: 'Application Id not found. Please check provided application Id.',
    },
    DOWNLOAD_SUCCESS: {
        en: 'Application downloaded Successfully.',
    },
    FAILED_TO_DOWNLOAD: {
        en: 'Failed to download Application',
    },
    DOWNLOAD_FETCH_SUCCESS: {
        en: 'Application downloaded details fetched Successfully.',
    },
    DOWNLOAD_FETCHED_FAILED: {
        en: 'Failed to fetch Application downloaded details',
    },
    APPLICATION_NOT_VERIFIED:{
        en: 'Failed to download, Application is not verified',

    }
};

export let ApplicationUpdatesMessage = {

    APPLICATION_ID_NOT_EXIST: {
        en: 'Application Id not found. Please check provided application Id.',
    },
    APPLICATION_NOT_APPROVED: {
        en: 'Application is not approved',
    },
    ACCESS_DENIED: {
        en: 'Access Denied for this API',
    },
    FAILED_TO_ADD_UPDATES: {
        en: 'Failed to Add updates for Application.Please check applicationId',
    },
    UPDATES_FETCHED_SUCCESS: {
        en: 'updates Fetched Successfully.',
    },
    UPDATES_FETCHED_FAILED: {
        en: 'Failed to fetch Updates.Please check provided Id',
    },
    UPDATE_ID_NOT_EXIST: {
        en: 'Update Id not found. Please check provided update Id.',
    },
    UPDATE_NOT_EXIST: {
        en: 'Updates not found. Please check provided Application Id.',
    },
    UPDATES_CREATED_SUCCESS: {
        en: 'Updates Created Successfully.',
    },
    UPDATES_MODIFIED_SUCCESS: {
        en: 'Updates Modified Successfully.',
    },
    UPDATES_MODIFIED_FAILED: {
        en: 'Failed to Modify Updates.Please check provided UpdateId',
    },
    UPDATES_DELETED_SUCCESS: {
        en: 'Updates deleted Successfully.',
    },
    UPDATES_DELETED_FAILED: {
        en: 'Failed to delete updates.',
    },

};

export let ApplicationShareMessage = {

    APPLICATION_ID_NOT_EXIST: {
        en: 'Application Id not found. Please check provided application Id.',
    },
    SHARE_ADDED_SUCCESS: {
        en: 'Share Added Successfully.',
    },
    FAILED_TO_ADD_SHARE: {
        en: 'Failed to add Share details for Application',
    },
    SHARE_FETCHED_SUCCESS: {
        en: 'Share Details Fetched Successfully.',
    },
    SHARE_FETCHED_FAILED: {
        en: 'Failed to fetch Share Details',
    },
    SHARE_ALREADY_EXIST: {
        en: 'Share details already present with this user',
    }
    }
    

export let ApplicationSearchMessage = {
    USER_HISTORY_SEARCH_FAILED: {
        en: 'Failed to fetch user search history',
    },
    USER_HISTORY_FETCHED_SUCCESS: {
        en: 'User history Fetched Successfully.',
    },
    USER_TOP_SEARCH_FAILED: {
        en: 'Failed to fetch top search  details',
    },
    USER_TOP_FETCHED_SUCCESS: {
        en: 'Top search details Fetched Successfully.',
    },
    SUGGESION_FETCHED_SUCCESS: {
        en: 'Suggestion Details Fetched Successfully.',
    },
    SUGGESION_FETCHED_FAILED: {
        en: 'Failed to fetch suggestion Details',
    },
}
export let ActivityMessage = {
    ACTIVITY_FETCHED_SUCCESS: {
        en: 'Activity Details Fetched Successfully',
    },
    FAILED_TO_FETCHED_ACTIVITY: {
        en: 'Failed to fetch activity',
    },
}

export let ApplicationMessage = {
    OWNTOKENAVAILABILITY_ENABLED: {
        en: 'Failed to submit application, ownTokenAvailability enabled but token details is not provided.'
    },
    OWNTOKENAVAILABILITY_DISABLED: {
        en: 'Failed to submit application,ownTokenAvailability is disabled but token details is provided. '
    },
    CHAIN_STATUS_DISABLED: {
        en: 'Failed to submit application, chain status enabled but chain details not provided.'
    },
    CHAIN_STATUS_ENABLED: {
        en: 'Failed to submit application, chain status enabled but chain details not provided.'
    },
    APP_IN_PROGRESS: {
        en: 'Failed to submit application, App in progress please provide Expected LaunchDate.'
    },
    APP_IS_LIVE: {
        en: 'Failed to submit application, Cant give Expected LaunchDate when App is Live'
    },
    APPLICATION_EXIST: {
        en: 'Application already exist.'
    },
    APPLICATION_SUBMITTED: {
        en: 'Application Submitted successfully.'
    },
    APPLICATION_FAILED_TO_SUBMIT: {
        en: 'Error while Submitting Application'
    },
    APPLICATION_FETCHED_SUCCESS: {
        en: 'Application Details Fetched Successfully',
    },
    APPLICATION_NOT_FOUND: {
        en: 'Application not found. Invalid appId!',
    },
    APPLICATION_FETCH_FAILED: {
        en: 'Error while fetching application details'
    },
    APPLICATION_RESUBMIT_LIMIT_REACHED: {
        en: 'Your app resubmission limit has been reached.'
    },
    APPLICATION_UPDATED_SUCCESS: {
        en: 'Application details updated successfully'
    },
    APPLICATION_UPDATED_FAILED: {
        en: 'Failed to update Application details'
    },
    APPLICATION_DELETED_SUCCESS: {
        en: 'Application deleted successfully'
    },
    FAILED_TO_DELETE_APPLICATION: {
        en: 'Failed to delete Application details'
    },
    APPLICATION_SEARCH_SUCCESS: {
        en: 'Successfully searched application details.'
    },
    FAILED_TO_SEARCH_APPLICATION: {
        en: 'Error while searching application details!'
    },
    APPLICATION_STATUS_UPDATED_SUCCESS: {
        en: 'Successfully Updated the Application status.'
    },
    FAILED_TO_DELETE_APPLICATION_STATUS: {
        en: 'Error while updating application status details last!'
    },
    FETCH_TRANDING_APPS_SUCCESS: {
        en: 'Trending applications fetched successfully'
    },
    FAILED_TO_FETCH_TRANDING_APPS: {
        en: 'Failed to fetch trending applications details'
    },
    DONOT_HAVE_ACCESS: {
        en: `Access denied!, you can't delete App which are created by someone else`
    },
}

export let CategoryMessage = {
    CATEGORY_FETCHED_SUCCESS: {
        en: 'Category Created Successfully!',
    },
    FAILED_TO_FETCHED_CATEGORY: {
        en: 'Failed to fetch Category',
    },
    INVALID_TAG_ID: {
        en: 'Tag Not Found! Invalid Tag Id.'
    },
    CATEGORY_ALREADY_EXIST: {
        en: 'Category Already Exists.'
    },
    CATEGORY_CREATION_FAILED: {
        en: 'Category Creation Failed.'
    },
    CATEGORY_CREATION_SUCCESS: {
        en: 'Category Created Successfully'
    },
    CATEGORY_ID_NOT_EXIST: {
        en: 'Category does not exists! Invalid Id'
    },
    CATEGORY_NAME_EXIST: {
        en: 'Category Name Already Exists!!'
    },
    CATEGORY_DISPLAY_NAME_EXIST: {
        en: 'Category Display Text Already Exists!!'
    },
    CATEGORY_UPDATE_SUCCESS: {
        en: 'Category updated successfully'
    },
    CATEGORY_UPDATE_FAILED: {
        en: 'Failed to update Category'
    },
    INVALID_CATEGORY_ID: {
        en: 'Invalid Category Id,Provide valid category Id'
    },
    CATEGORY_DELETE_SUCCESS: {
        en: 'Category Deleted successfully'
    },
    CATEGORY_SEARCH_SUCCESS: {
        en: 'Category search successfully'
    },
    CATEGORY_SEARCH_FAILED: {
        en: 'Failed to search Category'
    },
}

export let TagMessage = {
    TAG_NAME_EXIST: {
        en: 'Tag Name Already Exist!'
    },
    TAG_DISPLAY_EXIST: {
        en: 'Tag Display Text Already Exist!'
    },
    TAG_CREATED_SUCCESS: {
        en: 'Tag created successfully!'
    },
    TAG_CREATED_FAILED: {
        en: 'Tag creation failed!'
    },
    TAG_FETCH_SUCCESS: {
        en: 'Tag details fetched successFully'
    },
    TAG_NOT_FOUND: {
        en: 'Tags not found'
    },
    TAG_FETCH_FAILED: {
        en: 'Failed to Fetch tag details'
    },
    TAG_NOT_EXIST: {
        en: 'Tag not exist'
    },
    TAG_UPDATE_SUCCESS: {
        en: 'Tag updated successfully'
    },
    TAG_UPDATE_FAILED: {
        en: 'Failed to update tag'
    },
    TAG_ID_NOT_FOUND: {
        en: 'Tags id not found, Please provide valid tag id'
    },
    TAG_DELETE_SUCCESS: {
        en: 'Tag successfully Deleted'
    },
    FAILED_TO_DELETE_TAGS: {
        en: 'Failed to delete tags'
    },
    TAG_SEARCH_SUCCESS: {
        en: 'Tag details search successfully'
    },
    FAILED_TO_SEARCH_TAGS: {
        en: 'Failed to search tag details'
    },
    REQUIRED_ATLEAST_ONE: {
        en: 'Required atleast one field. Please provide tag id/category id.'
    },
    REQUIRED_ATLEAST_ONE_FIELD: {
        en: 'Required atleast one field. Please provide keyword/category id.'
    },
}

export let UploadMessage = {
    APPLICATION_ID_NOT_EXIST: {
        en: 'Application Id not found. Please check provided application Id.',
    },
    FILE_REQUIRED: {
        en: 'Should add minimum one file to upload '
    },
    FILE_LIMIT_REACHED: {
        en: 'Only 5 files can upload'
    },
    FAILED_TO_UPLOAD_FILES: {
        en: 'Error While Uploading files'
    },
    FILE_FETCH_SUCCESS: {
        en: 'file details fetched successfully.'
    },
    TYPE_AND_ID_REQUIRED: {
        en: 'Please Provide Type and application Id'
    },
    FAILED_TO_FETCH_FILES: {
        en: 'Unable to read list of files!'
    },
    FILE_DELETE_SUCCESS: {
        en: 'deleted all files successfully'
    },
    FAILED_TO_DELETE_FILES:{
        en: 'Unable to delete list of files!'
    }
}

