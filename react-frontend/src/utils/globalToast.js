import toast from 'react-hot-toast';

const toastConfig = {
  position: 'top-center',
  duration: 3000,
  reverseOrder: false,
};

export const globalToast = {
  success: (message, options) => toast.success(message, { ...toastConfig, ...options }),
  error: (message, options) => toast.error(message, { ...toastConfig, ...options }),
  loading: (message, options) => toast.loading(message, { ...toastConfig, ...options }),
  dismiss: toast.dismiss,
  promise: toast.promise,
};
