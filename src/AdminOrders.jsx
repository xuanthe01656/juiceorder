import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
} from "firebase/firestore";
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
  const [loginLoading, setLoginLoading] = useState(false);
  const [logoutLoading, setLogoutLoading] = useState(false);
  const [updatingOrderId, setUpdatingOrderId] = useState("");
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

  const playNotifySound = () => {
    try {
      const audioContext = new AudioContext();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);

      oscillator.frequency.value = 880;
      oscillator.type = "sine";

      gainNode.gain.setValueAtTime(0.2, audioContext.currentTime);
      oscillator.start();

      setTimeout(() => {
        oscillator.stop();
        audioContext.close();
      }, 500);
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 py-6">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-[2rem] bg-white p-6 shadow-2xl">
            <div className="flex justify-between gap-4 border-b pb-4">
              <div>
                <p className="text-sm font-bold uppercase text-orange-500">
                  Chi tiết đơn
                </p>
                <h3 className="text-2xl font-black text-[#0b6b2b]">
                  {selectedOrder.id}
                </h3>
                <p className="text-sm font-bold">
                  {statusText[selectedOrder.status] || selectedOrder.status}
                </p>
              </div>

              <button
                type="button"
                onClick={() => setSelectedOrder(null)}
                className="rounded-full bg-slate-100 px-4 py-2 font-black"
              >
                ×
              </button>
            </div>

            <div className="mt-5 space-y-3">
              {(selectedOrder.items || []).map((item) => (
                <div
                  key={item.id}
                  className="flex justify-between rounded-2xl bg-slate-50 p-4"
                >
                  <div>
                    <b>{item.name}</b>
                    <p className="text-sm text-slate-500">
                      {item.qty} ly x {formatMoney(item.price)}
                    </p>
                  </div>
                  <b>{formatMoney(item.total)}</b>
                </div>
              ))}
            </div>

            <div className="mt-5 rounded-2xl bg-orange-50 p-4">
              <p>Tạm tính: {formatMoney(selectedOrder.pricing?.subtotal)}</p>
              <p>Ưu đãi: -{formatMoney(selectedOrder.pricing?.discount)}</p>
              <p>
                Ship:{" "}
                {selectedOrder.pricing?.shipping === 0
                  ? "Free"
                  : formatMoney(selectedOrder.pricing?.shipping)}
              </p>
              <p className="mt-2 text-xl font-black text-orange-500">
                Tổng: {formatMoney(selectedOrder.pricing?.total)}
              </p>
            </div>

            <div className="mt-5 rounded-2xl bg-green-50 p-4">
              <p>Đường: {selectedOrder.options?.sugar}</p>
              <p>Đá: {selectedOrder.options?.ice}</p>
              <p>Ghi chú: {selectedOrder.note || "Không có"}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}