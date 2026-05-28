import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  setDoc,
} from "firebase/firestore";
import orderBellSound from "./assets/sounds/old-phone-bell.mp3";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";

import { auth, db } from "./firebase";

const formatMoney = (value) =>
  Number(value || 0).toLocaleString("vi-VN") + "đ";

const statusText = {
  pending: "Chờ xác nhận",
  confirmed: "Đã xác nhận",
  delivering: "Đang giao",
  completed: "Hoàn thành",
  cancelled: "Đã hủy",
};

const getDayStart = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

const getWeekStart = () => {
  const d = new Date();
  const day = d.getDay() || 7;
  d.setDate(d.getDate() - day + 1);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

const getMonthStart = () => {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

export default function AdminOrders() {
  const [user, setUser] = useState(null);
  const [loginForm, setLoginForm] = useState({
    email: "",
    password: "",
  });

  const [orders, setOrders] = useState([]);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const previousOrderIdsRef = useRef(new Set());
  const notifyAudioRef = useRef(null);
  const [loginLoading, setLoginLoading] = useState(false);
  const [logoutLoading, setLogoutLoading] = useState(false);
  const [updatingOrderId, setUpdatingOrderId] = useState("");
  const [products, setProducts] = useState([]);
  const [productSaving, setProductSaving] = useState(false);
  const [productForm, setProductForm] = useState({
    id: "",
    name: "",
    price: "",
    desc: "",
    sortOrder: "",
  });
  const [productsLoading, setProductsLoading] = useState(false);
  const [updatingProductId, setUpdatingProductId] = useState("");
  const saveProduct = async (event) => {
    event.preventDefault();
  
    if (productSaving) return;
  
    const productId = productForm.id.trim();
  
    if (!productId) {
      alert("Vui lòng nhập mã sản phẩm.");
      return;
    }
  
    if (!productForm.name.trim()) {
      alert("Vui lòng nhập tên sản phẩm.");
      return;
    }
  
    if (!Number(productForm.price)) {
      alert("Vui lòng nhập giá hợp lệ.");
      return;
    }
  
    try {
      setProductSaving(true);
  
      await setDoc(doc(db, "products", productId), {
        name: productForm.name.trim(),
        price: Number(productForm.price),
        desc: productForm.desc.trim(),
        imageKey: productId,
        sortOrder: Number(productForm.sortOrder || products.length + 1),
        inStock: true,
        active: true,
        updatedAtMillis: Date.now(),
      });
  
      setProductForm({
        id: "",
        name: "",
        price: "",
        desc: "",
        sortOrder: "",
      });
  
      alert("Đã lưu sản phẩm.");
    } catch (error) {
      console.error(error);
      alert("Không thể lưu sản phẩm.");
    } finally {
      setProductSaving(false);
    }
  };
  const hideProduct = async (product) => {
    const ok = window.confirm(`Ẩn sản phẩm "${product.name}" khỏi menu khách?`);
  
    if (!ok) return;
  
    try {
      setUpdatingProductId(product.id);
  
      await updateDoc(doc(db, "products", product.id), {
        active: false,
        inStock: false,
        updatedAtMillis: Date.now(),
      });
    } catch (error) {
      console.error(error);
      alert("Không thể ẩn sản phẩm.");
    } finally {
      setUpdatingProductId("");
    }
  };
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
    });

    return () => unsub();
  }, []);

  useEffect(() => {
    if (!user) {
      setOrders([]);
      setLoading(false);
      return;
    }

    setLoading(true);

    const q = query(
      collection(db, "orders"),
      orderBy("createdAtMillis", "desc")
    );

    const unsub = onSnapshot(q, (snapshot) => {
      const list = snapshot.docs.map((item) => ({
        id: item.id,
        ...item.data(),
      }));

      const oldIds = previousOrderIdsRef.current;
      const hasNewOrder = list.some((item) => !oldIds.has(item.id));

      if (oldIds.size > 0 && hasNewOrder && soundEnabled) {
        playNotifySound();
      }

      previousOrderIdsRef.current = new Set(list.map((item) => item.id));
      setOrders(list);
      setLoading(false);
    });

    return () => unsub();
  }, [user, soundEnabled]);
  useEffect(() => {
    if (!user) {
      setProducts([]);
      return;
    }
  
    setProductsLoading(true);
  
    const q = query(
      collection(db, "products"),
      orderBy("sortOrder", "asc")
    );
  
    const unsub = onSnapshot(q, (snapshot) => {
      const list = snapshot.docs.map((item) => ({
        id: item.id,
        ...item.data(),
      }));
  
      setProducts(list);
      setProductsLoading(false);
    });
  
    return () => unsub();
  }, [user]);
  const toggleProductStock = async (product) => {
    if (updatingProductId) return;
  
    try {
      setUpdatingProductId(product.id);
  
      await updateDoc(doc(db, "products", product.id), {
        inStock: product.inStock === false,
        updatedAtMillis: Date.now(),
      });
    } catch (error) {
      console.error(error);
      alert("Không thể cập nhật tình trạng món.");
    } finally {
      setUpdatingProductId("");
    }
  };
  const playNotifySound = async () => {
    try {
      if (!notifyAudioRef.current) return;
  
      notifyAudioRef.current.currentTime = 0;
      await notifyAudioRef.current.play();
    } catch (error) {
      console.error(error);
    }
  };

  const login = async (event) => {
    event.preventDefault();
    if (loginLoading) return;
    setLoginLoading(true);

    try {
    await signInWithEmailAndPassword(auth, loginForm.email, loginForm.password);
    } catch (error) {
    console.error(error);
    alert("Đăng nhập thất bại. Kiểm tra email/mật khẩu.");
    } finally {
    setLoginLoading(false);
    }
  };

  const updateOrderStatus = async (orderId, status) => {
    if (updatingOrderId) return;
    try {
      setUpdatingOrderId(orderId);
      await updateDoc(doc(db, "orders", orderId), {
        status,
        updatedAtMillis: Date.now(),
      });
    } catch (error) {
      console.error(error);
      alert("Không thể cập nhật trạng thái.");
    } finally {
      setUpdatingOrderId("");
    }
  };

  const stats = useMemo(() => {
    const validOrders = orders.filter((item) => item.status !== "cancelled");

    const calc = (startTime) => {
      const filtered = validOrders.filter(
        (item) => Number(item.createdAtMillis || 0) >= startTime
      );

      return {
        count: filtered.length,
        revenue: filtered.reduce(
          (sum, item) => sum + Number(item.pricing?.total || 0),
          0
        ),
      };
    };

    return {
      today: calc(getDayStart()),
      week: calc(getWeekStart()),
      month: calc(getMonthStart()),
      pending: orders.filter((item) => item.status === "pending").length,
    };
  }, [orders]);

  if (!user) {
    return (
      <div className="min-h-screen bg-[#fff7df] px-4 py-10">
        <form
          onSubmit={login}
          className="mx-auto max-w-md rounded-[2rem] bg-white p-6 shadow-2xl"
        >
          <h1 className="text-3xl font-black text-[#0b6b2b]">
            Chủ shop đăng nhập
          </h1>

          <p className="mt-2 text-sm text-slate-600">
            Đăng nhập để theo dõi và quản lý đơn hàng realtime.
          </p>

          <div className="mt-6 space-y-4">
            <input
              type="email"
              value={loginForm.email}
              onChange={(event) =>
                setLoginForm((prev) => ({
                  ...prev,
                  email: event.target.value,
                }))
              }
              className="w-full rounded-2xl border px-4 py-3 outline-none focus:border-[#0b6b2b] focus:ring-2 focus:ring-green-100"
              placeholder="Email chủ shop"
              required
            />

            <input
              type="password"
              value={loginForm.password}
              onChange={(event) =>
                setLoginForm((prev) => ({
                  ...prev,
                  password: event.target.value,
                }))
              }
              className="w-full rounded-2xl border px-4 py-3 outline-none focus:border-[#0b6b2b] focus:ring-2 focus:ring-green-100"
              placeholder="Mật khẩu"
              required
            />

            <button
                type="submit"
                disabled={loginLoading}
                className="w-full rounded-2xl bg-orange-500 px-6 py-4 font-black uppercase text-white shadow-lg hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-60"
                >
                {loginLoading ? "Đang đăng nhập..." : "Đăng nhập"}
            </button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#fff7df] text-slate-900">
      <audio
        ref={notifyAudioRef}
        src={orderBellSound}
        preload="auto"
      />
      <header className="bg-[#0b6b2b] px-4 py-6 text-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-black">Quản lý đơn hàng</h1>
            <p className="text-sm text-green-100">
              Nước ép nhà Mit - realtime dashboard
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => {
                setSoundEnabled(true);
                playNotifySound();
              }}
              className="rounded-2xl bg-white px-5 py-3 font-black text-[#0b6b2b]"
            >
              {soundEnabled ? "Âm thanh đã bật" : "Bật âm thanh"}
            </button>

            <button
                type="button"
                disabled={logoutLoading}
                onClick={async () => {
                    if (logoutLoading) return;
                    setLogoutLoading(true);
                    try {
                    await signOut(auth);
                    } finally {
                    setLogoutLoading(false);
                    }
                }}
                className="rounded-2xl bg-orange-500 px-5 py-3 font-black text-white disabled:cursor-not-allowed disabled:opacity-60"
                >
                {logoutLoading ? "Đang thoát..." : "Đăng xuất"}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8">
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["Hôm nay", stats.today.count, stats.today.revenue],
            ["Tuần này", stats.week.count, stats.week.revenue],
            ["Tháng này", stats.month.count, stats.month.revenue],
            ["Chờ xác nhận", stats.pending, 0],
          ].map(([label, count, revenue]) => (
            <div
              key={label}
              className="rounded-[2rem] bg-white p-5 shadow-lg"
            >
              <p className="text-sm font-bold uppercase text-orange-500">
                {label}
              </p>
              <h2 className="mt-2 text-3xl font-black text-[#0b6b2b]">
                {count} đơn
              </h2>
              {revenue > 0 && (
                <p className="mt-1 font-bold text-slate-600">
                  {formatMoney(revenue)}
                </p>
              )}
            </div>
          ))}
        </section>
        <section className="mt-8 rounded-[2rem] bg-white p-5 shadow-xl">
          <div className="mb-5">
            <h2 className="text-2xl font-black text-[#0b6b2b]">
              Quản lý món bán
            </h2>
            <p className="text-sm text-slate-500">
              Bật/tắt tình trạng còn hàng để khách không đặt nhầm.
            </p>
          </div>
          <form
            onSubmit={saveProduct}
            className="mb-6 grid gap-3 rounded-2xl bg-green-50 p-4 lg:grid-cols-6"
          >
            <input
              value={productForm.id}
              onChange={(e) =>
                setProductForm((prev) => ({ ...prev, id: e.target.value }))
              }
              className="rounded-xl border px-3 py-2 outline-none lg:col-span-1"
              placeholder="id: matcha"
            />

            <input
              value={productForm.name}
              onChange={(e) =>
                setProductForm((prev) => ({ ...prev, name: e.target.value }))
              }
              className="rounded-xl border px-3 py-2 outline-none lg:col-span-1"
              placeholder="Tên món"
            />

            <input
              value={productForm.price}
              onChange={(e) =>
                setProductForm((prev) => ({ ...prev, price: e.target.value }))
              }
              className="rounded-xl border px-3 py-2 outline-none lg:col-span-1"
              placeholder="Giá"
              inputMode="numeric"
            />
            <input
              value={productForm.desc}
              onChange={(e) =>
                setProductForm((prev) => ({ ...prev, desc: e.target.value }))
              }
              className="rounded-xl border px-3 py-2 outline-none lg:col-span-1"
              placeholder="Mô tả"
            />

            <button
              type="submit"
              disabled={productSaving}
              className="rounded-xl bg-orange-500 px-4 py-2 font-black text-white disabled:opacity-60"
            >
              {productSaving ? "Đang lưu..." : "Thêm món"}
            </button>
          </form>
          {productsLoading ? (
            <p className="rounded-2xl bg-slate-50 p-4">Đang tải món...</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {products.map((product) => (
                <div
                  key={product.id}
                  className="rounded-2xl border border-slate-100 bg-slate-50 p-4"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h3 className="font-black text-[#0b6b2b]">
                        {product.name}
                      </h3>
                      <p className="text-sm font-bold text-slate-500">
                        {formatMoney(product.price)}
                      </p>
                    </div>

                    <button
                      type="button"
                      disabled={updatingProductId === product.id}
                      onClick={() => toggleProductStock(product)}
                      className={`rounded-xl px-4 py-2 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-60 ${
                        product.inStock === false
                          ? "bg-red-500"
                          : "bg-[#0b6b2b]"
                      }`}
                    >
                      {updatingProductId === product.id
                        ? "Đang lưu..."
                        : product.inStock === false
                        ? "Hết hàng"
                        : "Còn hàng"}
                    </button>
                    <button
                      type="button"
                      disabled={updatingProductId === product.id}
                      onClick={() => hideProduct(product)}
                      className="rounded-xl bg-slate-200 px-4 py-2 text-sm font-black text-slate-700 disabled:opacity-60"
                    >
                      Ẩn
                    </button>
                  </div>
                </div>
              ))}
              {!products.length && (
                <div className="col-span-full rounded-2xl bg-slate-50 p-6 text-center text-slate-500">
                  Chưa có sản phẩm nào.
                </div>
              )}
            </div>
          )}
        </section>
        <section className="mt-8 rounded-[2rem] bg-white p-5 shadow-xl">
          <div className="mb-5 flex items-center justify-between gap-4">
            <div>
              <h2 className="text-2xl font-black text-[#0b6b2b]">
                Danh sách đơn hàng
              </h2>
              <p className="text-sm text-slate-500">
                Đơn mới sẽ tự hiện ở đầu danh sách.
              </p>
            </div>
          </div>

          {loading ? (
            <p className="rounded-2xl bg-slate-50 p-4">Đang tải...</p>
          ) : (
            <div className="space-y-4">
              {orders.map((order) => (
                <div
                  key={order.id}
                  className="rounded-[1.5rem] border border-slate-100 bg-slate-50 p-4"
                >
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <p className="text-xs font-bold uppercase text-orange-500">
                        {order.id}
                      </p>
                      <h3 className="text-xl font-black text-[#0b6b2b]">
                        {order.customer?.name} - {order.customer?.phone}
                      </h3>
                      <p className="mt-1 text-sm text-slate-600">
                        {order.customer?.address}
                      </p>
                      <p className="mt-1 text-sm font-bold">
                        Tổng: {formatMoney(order.pricing?.total)}
                      </p>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {["pending", "confirmed", "delivering", "completed"].map(
                        (status) => (
                          <button
                            disabled={updatingOrderId === order.id}
                            key={status}
                            type="button"
                            onClick={() => updateOrderStatus(order.id, status)}
                            className={`rounded-xl px-3 py-2 text-sm font-black disabled:cursor-not-allowed disabled:opacity-60 ${
                              order.status === status
                                ? "bg-[#0b6b2b] text-white"
                                : "bg-white text-slate-600"
                            }`}
                          >
                            {updatingOrderId === order.id ? "Đang lưu..." : statusText[status]}
                          </button>
                        )
                      )}

                    <button
                        type="button"
                        disabled={updatingOrderId === order.id}
                        onClick={() => updateOrderStatus(order.id, "cancelled")}
                        className={`rounded-xl px-3 py-2 text-sm font-black disabled:cursor-not-allowed disabled:opacity-60 ${
                            order.status === "cancelled"
                            ? "bg-red-500 text-white"
                            : "bg-white text-red-500"
                        }`}
                        >
                        {updatingOrderId === order.id ? "Đang lưu..." : "Hủy"}
                    </button>

                      <button
                        type="button"
                        onClick={() => setSelectedOrder(order)}
                        className="rounded-xl bg-orange-500 px-3 py-2 text-sm font-black text-white"
                      >
                        Chi tiết
                      </button>
                    </div>
                  </div>
                </div>
              ))}

              {!orders.length && (
                <p className="rounded-2xl bg-slate-50 p-4 text-slate-500">
                  Chưa có đơn hàng.
                </p>
              )}
            </div>
          )}
        </section>
      </main>

      {selectedOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 py-6 backdrop-blur-sm">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-[2rem] bg-white p-6 shadow-2xl">
            
            {/* Header Modal */}
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-4">
              <div>
                <p className="text-sm font-bold uppercase text-orange-500">
                  Chi tiết đơn
                </p>
                <h3 className="text-2xl font-black text-[#0b6b2b]">
                  {selectedOrder.id}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setSelectedOrder(null)}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-xl font-black text-slate-600 transition hover:bg-slate-200"
              >
                ×
              </button>
            </div>

            {/* Nội dung chi tiết */}
            <div className="mt-5 space-y-4 text-slate-700">
              
              {/* Khối 1: Thời gian & Trạng thái */}
              <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                <p className="text-sm text-slate-500">
                  Thời gian đặt: <b className="text-slate-800">{selectedOrder.createdAtMillis ? new Date(selectedOrder.createdAtMillis).toLocaleString("vi-VN") : "Không rõ"}</b>
                </p>
                <p className="mt-1 text-sm text-slate-500">
                  Trạng thái hiện tại: <span className="inline-block rounded-full bg-orange-100 px-2.5 py-0.5 text-xs font-bold text-orange-700">{statusText[selectedOrder.status] || selectedOrder.status}</span>
                </p>
              </div>

              {/* Khối 2: Thông tin Khách hàng */}
              <div className="rounded-2xl border border-blue-100 bg-blue-50/50 p-4">
                <h4 className="mb-2 text-xs font-black tracking-wider text-blue-900 uppercase">Thông tin giao hàng</h4>
                <div className="space-y-1.5 text-sm">
                  <p>Khách hàng: <b className="text-base text-slate-900">{selectedOrder.customer?.name || "Không có tên"}</b></p>
                  <p>
                    Số điện thoại:{" "}
                    <a href={`tel:${selectedOrder.customer?.phone}`} className="font-bold text-blue-600 underline hover:text-blue-800">
                      {selectedOrder.customer?.phone || "Không có SĐT"}
                    </a>
                  </p>
                  <p className="leading-relaxed">
                    Địa chỉ: <b className="text-slate-900">{selectedOrder.customer?.address || "Không có địa chỉ"}</b>
                  </p>
                </div>
              </div>

              {/* Khối 3: Tùy chọn khẩu vị & Ghi chú */}
              <div className="rounded-2xl border border-green-100 bg-green-50/40 p-4">
                <h4 className="mb-2 text-xs font-black tracking-wider text-green-900 uppercase">Tùy chọn khẩu vị & Ghi chú</h4>
                <p className="text-sm">
                  Ghi chú:{" "}
                  <span className={`font-medium ${selectedOrder.note ? "rounded bg-yellow-100 px-1.5 py-0.5 text-slate-900" : "italic text-slate-400"}`}>
                    {selectedOrder.note || "Không có ghi chú"}
                  </span>
                </p>
              </div>

              {/* Khối 4: Danh sách món */}
              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <h4 className="mb-3 text-xs font-black tracking-wider text-slate-900 uppercase">Danh sách món ({selectedOrder.items?.length || 0})</h4>
                <div className="max-h-60 space-y-2.5 overflow-y-auto pr-1">
                  {(selectedOrder.items || []).map((item, idx) => (
                    <div
                      key={item.lineId || `${item.id}-${idx}`}
                      className="flex items-start justify-between rounded-xl border border-slate-100 bg-slate-50 p-3"
                    >
                      <div>
                        <b className="text-sm text-slate-800">{item.name}</b>
                        <p className="mt-0.5 text-xs text-slate-500">
                          {item.qty} ly x {formatMoney(item.finalPrice || item.price)}
                        </p>
                        {item.sweetenerType && item.sweetenerType !== "none" && (
                          <p className="text-xs text-slate-500">
                            {item.sweetenerType === "milk"
                              ? `Sữa: ${item.milk || "Bình thường"} (+2k/ly)`
                              : `Đường: ${item.sugar || "Bình thường"}`}
                          </p>
                        )}
                        <p className="text-xs text-slate-500">
                          Đá: {item.ice || "Bình thường"}
                        </p>
                      </div>
                      <b className="text-sm text-slate-900">{formatMoney(item.total)}</b>
                    </div>
                  ))}
                </div>
              </div>

              {/* Khối 5: Chi tiết thanh toán */}
              <div className="rounded-2xl border border-orange-100 bg-orange-50 p-4">
                <h4 className="mb-2 text-xs font-black tracking-wider text-orange-900 uppercase">Chi tiết thanh toán</h4>
                <div className="space-y-1.5 text-sm text-slate-600">
                  <div className="flex justify-between">
                    <span>Tạm tính:</span>
                    <span>{formatMoney(selectedOrder.pricing?.subtotal)}</span>
                  </div>
                  <div className="flex justify-between text-red-600">
                    <span>Ưu đãi giảm giá:</span>
                    <span>-{formatMoney(selectedOrder.pricing?.discount)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Phụ thu sữa:</span>
                    <span>{selectedOrder.pricing?.milkSurchargeTotal ? `+${formatMoney(selectedOrder.pricing.milkSurchargeTotal)}` : "0đ"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Phí giao hàng:</span>
                    <span>
                      {selectedOrder.pricing?.shipping === 0
                        ? "Miễn phí (Free)"
                        : formatMoney(selectedOrder.pricing?.shipping)}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center justify-between border-t border-orange-200 pt-2 text-base font-black text-orange-600">
                    <span className="text-slate-800">Tổng doanh thu:</span>
                    <span className="text-2xl">{formatMoney(selectedOrder.pricing?.total)}</span>
                  </div>
                </div>
              </div>

            </div>
          </div>
        </div>
      )}
    </div>
  );
}