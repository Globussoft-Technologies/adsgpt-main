// import { RouterProvider } from 'react-router-dom';
// import './App.css';
// import '@/pages/Editor/Editor.css';
// import router from '@/routes/router';
// // Swiper css imports
// import 'swiper/css';
// import 'swiper/css/navigation';
// import 'swiper/css/pagination';
// import 'swiper/css/scrollbar';
// import { ToastContainer } from "react-toastify";
// import "react-toastify/dist/ReactToastify.css";

// function App() {
//   return (
//      <>
//       <RouterProvider router={router} />;

//       <ToastContainer
//         position="top-right"
//         autoClose={3000}
//         theme="dark"
//       />

//      </>
//   )

// }

// export default App;

import { RouterProvider } from 'react-router-dom';
import './App.css';
import '@/pages/Editor/Editor.css';
import router from '@/routes/router';
// Swiper css imports
import 'swiper/css';
import 'swiper/css/navigation';
import 'swiper/css/pagination';
import 'swiper/css/scrollbar';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import useFacebookOAuthErrorToast from '@/hooks/useFacebookOAuthErrorToast';

function App() {
  useFacebookOAuthErrorToast();

  return (
    <>
      <RouterProvider router={router} />
      <ToastContainer
        position="top-right"
        autoClose={5000}
        hideProgressBar={false}
        newestOnTop={false}
        closeOnClick
        rtl={false}
        pauseOnFocusLoss
        draggable
        pauseOnHover
        theme="dark"
        style={{
          zIndex: 9999,
        }}
      />
    </>
  );
}

export default App;
