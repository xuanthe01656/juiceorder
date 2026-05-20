import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import AdminOrders from "./AdminOrders.jsx";
import "./index.css";

const isAdminPage = window.location.pathname === "/admin";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    {isAdminPage ? <AdminOrders /> : <App />}
  </React.StrictMode>
);