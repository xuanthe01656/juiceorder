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

const orderStatusPriority = {
  pending: 1,
  confirmed: 2,
  delivering: 3,
  completed: 4,
  cancelled: 5,
};

const orderStatusFilters = [
  { id: "all", label: "Tất cả" },
  { id: "pending", label: "Chờ xác nhận" },
  { id: "confirmed", label: "Đã xác nhận" },
  { id: "delivering", label: "Đang giao" },
  { id: "completed", label: "Hoàn thành" },
  { id: "cancelled", label: "Đã hủy" },
];

const tabItems = [
  { id: "stats", label: "Thống kê", icon: "📊" },
  { id: "products", label: "Quản lý sản phẩm", icon: "🥤" },
  { id: "orders", label: "Quản lý đơn hàng", icon: "🧾" },
  { id: "inventory", label: "Nhập hàng & lợi nhuận", icon: "📦" },
];

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

const getProductStatus = (product) => {
  if (product.active === false) return "Đang ẩn";
  if (product.inStock === false) return "Hết hàng";
  return "Còn hàng";
};

export default function AdminOrders() {
  const [activeTab, setActiveTab] = useState("stats");
  const [orderStatusFilter, setOrderStatusFilter] = useState("all");
  const [orderKeyword, setOrderKeyword] = useState("");
  const [orderPage, setOrderPage] = useState(1);
  const [orderPageSize, setOrderPageSize] = useState(10);
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
    relatedIds: "",
    isBestSeller: false,
  });
  const [editingPrices, setEditingPrices] = useState({});
  const [productsLoading, setProductsLoading] = useState(false);
  const [updatingProductId, setUpdatingProductId] = useState("");

  const [inventoryEntries, setInventoryEntries] = useState([]);
  const [inventoryLoading, setInventoryLoading] = useState(false);
  const [inventorySaving, setInventorySaving] = useState(false);
  const [inventoryForm, setInventoryForm] = useState({
    productId: "",
    itemName: "",
    qty: "",
    unitCost: "",
    note: "",
  });

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
        relatedIds: productForm.relatedIds
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
        isBestSeller: productForm.isBestSeller === true,
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
        relatedIds: "",
        isBestSeller: false,
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

    const q = query(collection(db, "orders"), orderBy("createdAtMillis", "desc"));

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

    const q = query(collection(db, "products"), orderBy("sortOrder", "asc"));

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

  useEffect(() => {
    if (!user) {
      setInventoryEntries([]);
      return;
    }

    setInventoryLoading(true);

    const q = query(
      collection(db, "inventoryEntries"),
      orderBy("createdAtMillis", "desc")
    );

    const unsub = onSnapshot(
      q,
      (snapshot) => {
        const list = snapshot.docs.map((item) => ({
          id: item.id,
          ...item.data(),
        }));

        setInventoryEntries(list);
        setInventoryLoading(false);
      },
      (error) => {
        console.error(error);
        setInventoryEntries([]);
        setInventoryLoading(false);
      }
    );

    return () => unsub();
  }, [user]);

  const toggleProductStock = async (product) => {
    if (updatingProductId) return;

    const nextInStock = product.inStock === false;

    try {
      setUpdatingProductId(product.id);

      await updateDoc(doc(db, "products", product.id), {
        inStock: nextInStock,
        active: nextInStock ? true : product.active !== false,
        updatedAtMillis: Date.now(),
      });
    } catch (error) {
      console.error(error);
      alert("Không thể cập nhật tình trạng món.");
    } finally {
      setUpdatingProductId("");
    }
  };

  const toggleProductBestSeller = async (product) => {
    if (updatingProductId) return;

    try {
      setUpdatingProductId(product.id);

      await updateDoc(doc(db, "products", product.id), {
        isBestSeller: product.isBestSeller !== true,
        updatedAtMillis: Date.now(),
      });
    } catch (error) {
      console.error(error);
      alert("Không thể cập nhật món bán chạy.");
    } finally {
      setUpdatingProductId("");
    }
  };

  const updateProductPrice = async (product) => {
    if (updatingProductId) return;

    const rawPrice = editingPrices[product.id];

    if (!rawPrice) {
      alert("Vui lòng nhập giá mới.");
      return;
    }

    const newPrice = Number(rawPrice);

    if (!newPrice || newPrice <= 0) {
      alert("Giá không hợp lệ.");
      return;
    }

    try {
      setUpdatingProductId(product.id);

      await updateDoc(doc(db, "products", product.id), {
        price: newPrice,
        updatedAtMillis: Date.now(),
      });

      alert("Đã cập nhật giá.");
      setEditingPrices((prev) => ({
        ...prev,
        [product.id]: "",
      }));
    } catch (error) {
      console.error(error);
      alert("Không thể cập nhật giá.");
    } finally {
      setUpdatingProductId("");
    }
  };

  const saveInventoryEntry = async (event) => {
    event.preventDefault();

    if (inventorySaving) return;

    const qty = Number(inventoryForm.qty);
    const unitCost = Number(inventoryForm.unitCost);

    if (!inventoryForm.itemName.trim()) {
      alert("Vui lòng nhập tên nguyên liệu / món nhập.");
      return;
    }

    if (!qty || qty <= 0) {
      alert("Số lượng nhập không hợp lệ.");
      return;
    }

    if (!unitCost || unitCost <= 0) {
      alert("Đơn giá nhập không hợp lệ.");
      return;
    }

    const selectedProduct = products.find(
      (product) => product.id === inventoryForm.productId
    );

    const entryId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    try {
      setInventorySaving(true);

      await setDoc(doc(db, "inventoryEntries", entryId), {
        productId: inventoryForm.productId || "",
        productName: selectedProduct?.name || "",
        itemName: inventoryForm.itemName.trim(),
        qty,
        unitCost,
        totalCost: qty * unitCost,
        note: inventoryForm.note.trim(),
        createdAtMillis: Date.now(),
      });

      setInventoryForm({
        productId: "",
        itemName: "",
        qty: "",
        unitCost: "",
        note: "",
      });

      alert("Đã lưu phiếu nhập.");
    } catch (error) {
      console.error(error);
      alert("Không thể lưu phiếu nhập.");
    } finally {
      setInventorySaving(false);
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

  const topProducts = useMemo(() => {
    const productMap = new Map();

    orders
      .filter((order) => order.status !== "cancelled")
      .forEach((order) => {
        (order.items || []).forEach((item) => {
          const key = item.id || item.name;
          const current = productMap.get(key) || {
            id: key,
            name: item.name || "Không rõ món",
            qty: 0,
            revenue: 0,
          };

          current.qty += Number(item.qty || 0);
          current.revenue += Number(item.total || 0);
          productMap.set(key, current);
        });
      });

    return Array.from(productMap.values())
      .sort((a, b) => b.qty - a.qty || b.revenue - a.revenue)
      .slice(0, 5);
  }, [orders]);

  const inventorySummary = useMemo(() => {
    const map = new Map();

    inventoryEntries.forEach((entry) => {
      const key = entry.productId || entry.itemName;
      const current = map.get(key) || {
        id: key,
        productId: entry.productId || "",
        name: entry.productName || entry.itemName || "Không rõ",
        qty: 0,
        totalCost: 0,
        avgCost: 0,
      };

      current.qty += Number(entry.qty || 0);
      current.totalCost += Number(entry.totalCost || 0);
      current.avgCost = current.qty > 0 ? current.totalCost / current.qty : 0;

      map.set(key, current);
    });

    return Array.from(map.values()).sort((a, b) =>
      a.name.localeCompare(b.name, "vi")
    );
  }, [inventoryEntries]);

  const profitStats = useMemo(() => {
    const validOrders = orders.filter((item) => item.status !== "cancelled");

    const costMap = new Map();
    inventorySummary.forEach((item) => {
      if (item.productId) {
        costMap.set(item.productId, item.avgCost);
      }
    });

    let revenue = 0;
    let estimatedCost = 0;
    let soldQty = 0;

    validOrders.forEach((order) => {
      revenue += Number(order.pricing?.total || 0);

      (order.items || []).forEach((item) => {
        const qty = Number(item.qty || 0);
        soldQty += qty;
        estimatedCost += qty * Number(costMap.get(item.id) || 0);
      });
    });

    return {
      revenue,
      estimatedCost,
      grossProfit: revenue - estimatedCost,
      soldQty,
      margin: revenue > 0 ? ((revenue - estimatedCost) / revenue) * 100 : 0,
      purchaseCost: inventoryEntries.reduce(
        (sum, item) => sum + Number(item.totalCost || 0),
        0
      ),
    };
  }, [orders, inventoryEntries, inventorySummary]);

  const orderStatusCounts = useMemo(() => {
    const counts = {
      all: orders.length,
      pending: 0,
      confirmed: 0,
      delivering: 0,
      completed: 0,
      cancelled: 0,
    };

    orders.forEach((order) => {
      const status = order.status || "pending";
      if (counts[status] !== undefined) {
        counts[status] += 1;
      }
    });

    return counts;
  }, [orders]);

  const filteredOrders = useMemo(() => {
    const keyword = orderKeyword.trim().toLowerCase();

    return [...orders]
      .filter((order) => {
        if (orderStatusFilter !== "all" && order.status !== orderStatusFilter) {
          return false;
        }

        if (!keyword) return true;

        const searchableText = [
          order.id,
          order.status,
          statusText[order.status],
          order.customer?.name,
          order.customer?.phone,
          order.customer?.address,
          order.note,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();

        return searchableText.includes(keyword);
      })
      .sort((a, b) => {
        const priorityA = orderStatusPriority[a.status] || 99;
        const priorityB = orderStatusPriority[b.status] || 99;

        if (priorityA !== priorityB) {
          return priorityA - priorityB;
        }

        return Number(b.createdAtMillis || 0) - Number(a.createdAtMillis || 0);
      });
  }, [orders, orderKeyword, orderStatusFilter]);

  const totalOrderPages = Math.max(
    1,
    Math.ceil(filteredOrders.length / Number(orderPageSize || 10))
  );

  const paginatedOrders = useMemo(() => {
    const pageSize = Number(orderPageSize || 10);
    const safePage = Math.min(orderPage, totalOrderPages);
    const start = (safePage - 1) * pageSize;

    return filteredOrders.slice(start, start + pageSize);
  }, [filteredOrders, orderPage, orderPageSize, totalOrderPages]);

  useEffect(() => {
    setOrderPage(1);
  }, [orderKeyword, orderStatusFilter, orderPageSize]);

  useEffect(() => {
    if (orderPage > totalOrderPages) {
      setOrderPage(totalOrderPages);
    }
  }, [orderPage, totalOrderPages]);

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

  const renderStatsTab = () => (
    <div className="space-y-8">
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Hôm nay", stats.today.count, stats.today.revenue, "bg-green-50"],
          ["Tuần này", stats.week.count, stats.week.revenue, "bg-orange-50"],
          ["Tháng này", stats.month.count, stats.month.revenue, "bg-blue-50"],
          ["Chờ xác nhận", stats.pending, 0, "bg-red-50"],
        ].map(([label, count, revenue, bg]) => (
          <div key={label} className={`rounded-[2rem] ${bg} p-5 shadow-lg`}>
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

      <section className="rounded-[2rem] bg-white p-5 shadow-xl">
        <div className="mb-5 flex items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-black text-[#0b6b2b]">
              Top món bán chạy
            </h2>
            <p className="text-sm text-slate-500">
              Tính theo tổng số ly của các đơn chưa hủy.
            </p>
          </div>
        </div>

        {topProducts.length > 0 ? (
          <div className="grid gap-3 md:grid-cols-5">
            {topProducts.map((product, index) => (
              <div
                key={product.id}
                className="rounded-2xl bg-orange-50 p-4 shadow-sm ring-1 ring-orange-100"
              >
                <p className="text-xs font-black uppercase text-orange-500">
                  #{index + 1}
                </p>
                <h3 className="mt-1 truncate font-black text-[#0b6b2b]">
                  {product.name}
                </h3>
                <p className="mt-2 text-2xl font-black text-orange-500">
                  {product.qty} ly
                </p>
                <p className="text-sm font-bold text-slate-500">
                  {formatMoney(product.revenue)}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <p className="rounded-2xl bg-slate-50 p-4 text-slate-500">
            Chưa có dữ liệu bán hàng.
          </p>
        )}
      </section>

      <section className="rounded-[2rem] bg-white p-5 shadow-xl">
        <h2 className="text-2xl font-black text-[#0b6b2b]">
          Ước tính lợi nhuận
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          Tính theo giá nhập trung bình đã khai báo ở tab Nhập hàng. Đây là số ước tính để tham khảo.
        </p>

        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["Doanh thu", profitStats.revenue],
            ["Giá vốn ước tính", profitStats.estimatedCost],
            ["Lợi nhuận gộp", profitStats.grossProfit],
            ["Tổng tiền nhập", profitStats.purchaseCost],
          ].map(([label, value]) => (
            <div key={label} className="rounded-2xl bg-slate-50 p-4">
              <p className="text-xs font-black uppercase text-slate-500">
                {label}
              </p>
              <p className="mt-2 text-2xl font-black text-orange-500">
                {formatMoney(value)}
              </p>
            </div>
          ))}
        </div>

        <p className="mt-4 rounded-2xl bg-green-50 p-4 text-sm font-bold text-[#0b6b2b]">
          Biên lợi nhuận ước tính: {profitStats.margin.toFixed(1)}% · Đã bán: {profitStats.soldQty} ly
        </p>
      </section>
    </div>
  );

  const renderProductsTab = () => (
    <section className="rounded-[2rem] bg-white p-5 shadow-xl">
      <div className="mb-5">
        <h2 className="text-2xl font-black text-[#0b6b2b]">
          Quản lý món bán
        </h2>
        <p className="text-sm text-slate-500">
          Thêm món, sửa giá, bật/tắt còn hàng, bán chạy hoặc ẩn món khỏi client.
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

        <input
          value={productForm.relatedIds}
          onChange={(e) =>
            setProductForm((prev) => ({ ...prev, relatedIds: e.target.value }))
          }
          className="rounded-xl border px-3 py-2 outline-none lg:col-span-1"
          placeholder="Mua kèm: cam,oi"
        />

        <label className="flex items-center justify-center gap-2 rounded-xl bg-white px-3 py-2 text-sm font-black text-orange-500 ring-1 ring-orange-100">
          <input
            type="checkbox"
            checked={productForm.isBestSeller}
            onChange={(e) =>
              setProductForm((prev) => ({
                ...prev,
                isBestSeller: e.target.checked,
              }))
            }
          />
          Bán chạy
        </label>

        <button
          type="submit"
          disabled={productSaving}
          className="rounded-xl bg-orange-500 px-4 py-2 font-black text-white disabled:opacity-60 lg:col-span-6"
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
              className="rounded-3xl border border-slate-100 bg-white p-4 shadow-sm ring-1 ring-slate-100 transition hover:-translate-y-0.5 hover:shadow-lg"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="truncate text-lg font-black text-[#0b6b2b]">
                    {product.name}
                  </h3>

                  <p className="mt-1 text-sm font-bold text-slate-500">
                    Giá hiện tại
                  </p>

                  <p className="text-2xl font-black text-orange-500">
                    {formatMoney(product.price)}
                  </p>
                </div>

                <span
                  className={`shrink-0 rounded-full px-3 py-1 text-xs font-black ${
                    product.active === false
                      ? "bg-blue-50 text-blue-600"
                      : product.inStock === false
                      ? "bg-red-50 text-red-600"
                      : "bg-green-50 text-[#0b6b2b]"
                  }`}
                >
                  {getProductStatus(product)}
                </span>
              </div>

              <div className="mt-4 rounded-2xl bg-slate-50 p-3">
                <label className="mb-1 block text-xs font-black uppercase text-slate-500">
                  Cập nhật giá
                </label>

                <div className="grid grid-cols-[1fr_auto] gap-2">
                  <input
                    value={editingPrices[product.id] ?? ""}
                    onChange={(e) =>
                      setEditingPrices((prev) => ({
                        ...prev,
                        [product.id]: e.target.value,
                      }))
                    }
                    inputMode="numeric"
                    placeholder="Nhập giá mới"
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
                  />

                  <button
                    type="button"
                    disabled={updatingProductId === product.id}
                    onClick={() => updateProductPrice(product)}
                    className="rounded-xl bg-orange-500 px-4 py-2 text-sm font-black text-white shadow-sm hover:bg-orange-600 disabled:opacity-60"
                  >
                    Lưu
                  </button>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
                <button
                  type="button"
                  disabled={updatingProductId === product.id}
                  onClick={() => toggleProductStock(product)}
                  className={`rounded-2xl px-4 py-3 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-60 ${
                    product.active === false
                      ? "bg-blue-500 hover:bg-blue-600"
                      : product.inStock === false
                      ? "bg-red-500 hover:bg-red-600"
                      : "bg-[#0b6b2b] hover:bg-green-800"
                  }`}
                >
                  {updatingProductId === product.id
                    ? "Đang lưu..."
                    : product.active === false
                    ? "Mở lại"
                    : product.inStock === false
                    ? "Hết hàng"
                    : "Còn hàng"}
                </button>

                <button
                  type="button"
                  disabled={updatingProductId === product.id}
                  onClick={() => toggleProductBestSeller(product)}
                  className={`rounded-2xl px-4 py-3 text-sm font-black disabled:opacity-60 ${
                    product.isBestSeller === true
                      ? "bg-orange-500 text-white hover:bg-orange-600"
                      : "bg-orange-50 text-orange-600 hover:bg-orange-100"
                  }`}
                >
                  {product.isBestSeller === true ? "🔥 Bán chạy" : "Bán chạy"}
                </button>

                <button
                  type="button"
                  disabled={updatingProductId === product.id}
                  onClick={() => hideProduct(product)}
                  className="rounded-2xl bg-slate-100 px-4 py-3 text-sm font-black text-slate-700 hover:bg-slate-200 disabled:opacity-60"
                >
                  Ẩn món
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
  );

  const renderOrdersTab = () => {
    const startItem = filteredOrders.length
      ? (orderPage - 1) * Number(orderPageSize || 10) + 1
      : 0;
    const endItem = Math.min(
      orderPage * Number(orderPageSize || 10),
      filteredOrders.length
    );

    return (
      <section className="rounded-[2rem] bg-white p-5 shadow-xl">
        <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-2xl font-black text-[#0b6b2b]">
              Danh sách đơn hàng
            </h2>
            <p className="text-sm text-slate-500">
              Ưu tiên hiển thị: Chờ xác nhận → Đã xác nhận → Đang giao → Hoàn thành → Đã hủy.
            </p>
          </div>

          <div className="rounded-2xl bg-orange-50 px-4 py-3 text-sm font-black text-orange-600">
            {filteredOrders.length} / {orders.length} đơn
          </div>
        </div>

        <div className="mb-5 grid gap-3 rounded-2xl bg-slate-50 p-4 lg:grid-cols-[1fr_auto] lg:items-end">
          <div>
            <label className="mb-1 block text-xs font-black uppercase text-slate-500">
              Tìm kiếm đơn hàng
            </label>
            <input
              value={orderKeyword}
              onChange={(event) => setOrderKeyword(event.target.value)}
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold outline-none focus:border-[#0b6b2b] focus:ring-2 focus:ring-green-100"
              placeholder="Tìm mã đơn, tên khách, SĐT, địa chỉ..."
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-black uppercase text-slate-500">
              Số đơn / trang
            </label>
            <select
              value={orderPageSize}
              onChange={(event) => setOrderPageSize(Number(event.target.value))}
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold outline-none focus:border-[#0b6b2b] focus:ring-2 focus:ring-green-100 lg:w-40"
            >
              {[5, 10, 20, 50].map((size) => (
                <option key={size} value={size}>
                  {size} đơn
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mb-5 flex gap-2 overflow-x-auto pb-1">
          {orderStatusFilters.map((filter) => (
            <button
              key={filter.id}
              type="button"
              onClick={() => setOrderStatusFilter(filter.id)}
              className={`shrink-0 rounded-2xl px-4 py-3 text-sm font-black transition ${
                orderStatusFilter === filter.id
                  ? "bg-[#0b6b2b] text-white shadow-md"
                  : "bg-slate-50 text-slate-600 hover:bg-green-50 hover:text-[#0b6b2b]"
              }`}
            >
              {filter.label}
              <span className="ml-2 rounded-full bg-white/70 px-2 py-0.5 text-xs text-slate-700">
                {orderStatusCounts[filter.id] || 0}
              </span>
            </button>
          ))}
        </div>

        {loading ? (
          <p className="rounded-2xl bg-slate-50 p-4">Đang tải...</p>
        ) : (
          <>
            <div className="space-y-4">
              {paginatedOrders.map((order) => (
                <div
                  key={order.id}
                  className={`rounded-[1.5rem] border p-4 transition hover:-translate-y-0.5 hover:shadow-lg ${
                    order.status === "pending"
                      ? "border-orange-200 bg-orange-50"
                      : order.status === "confirmed"
                      ? "border-green-200 bg-green-50"
                      : order.status === "delivering"
                      ? "border-blue-200 bg-blue-50"
                      : order.status === "cancelled"
                      ? "border-red-100 bg-red-50/60 opacity-80"
                      : "border-slate-100 bg-slate-50"
                  }`}
                >
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="break-all text-xs font-bold uppercase text-orange-500">
                          {order.id}
                        </p>

                        <span
                          className={`rounded-full px-3 py-1 text-xs font-black ${
                            order.status === "pending"
                              ? "bg-orange-500 text-white"
                              : order.status === "confirmed"
                              ? "bg-[#0b6b2b] text-white"
                              : order.status === "delivering"
                              ? "bg-blue-500 text-white"
                              : order.status === "cancelled"
                              ? "bg-red-500 text-white"
                              : "bg-slate-200 text-slate-700"
                          }`}
                        >
                          {statusText[order.status] || order.status}
                        </span>
                      </div>

                      <h3 className="mt-2 text-xl font-black text-[#0b6b2b]">
                        {order.customer?.name} - {order.customer?.phone}
                      </h3>
                      <p className="mt-1 text-sm text-slate-600">
                        {order.customer?.address}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-3 text-sm font-bold">
                        <span>Tổng: {formatMoney(order.pricing?.total)}</span>
                        <span>Số món: {(order.items || []).length}</span>
                        <span>
                          {order.createdAtMillis
                            ? new Date(order.createdAtMillis).toLocaleString("vi-VN")
                            : "Không rõ thời gian"}
                        </span>
                      </div>
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
                            {updatingOrderId === order.id
                              ? "Đang lưu..."
                              : statusText[status]}
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

              {!filteredOrders.length && (
                <p className="rounded-2xl bg-slate-50 p-4 text-slate-500">
                  Không có đơn hàng phù hợp với bộ lọc.
                </p>
              )}
            </div>

            <div className="mt-5 flex flex-col gap-3 rounded-2xl bg-slate-50 p-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm font-bold text-slate-600">
                Hiển thị {startItem} - {endItem} trong {filteredOrders.length} đơn
              </p>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={orderPage <= 1}
                  onClick={() => setOrderPage((prev) => Math.max(1, prev - 1))}
                  className="rounded-xl bg-white px-4 py-2 text-sm font-black text-slate-700 shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Trước
                </button>

                {Array.from({ length: totalOrderPages }).map((_, index) => {
                  const page = index + 1;
                  const shouldShow =
                    page === 1 ||
                    page === totalOrderPages ||
                    Math.abs(page - orderPage) <= 1;

                  if (!shouldShow) {
                    if (page === orderPage - 2 || page === orderPage + 2) {
                      return (
                        <span key={page} className="px-1 text-slate-400">
                          ...
                        </span>
                      );
                    }

                    return null;
                  }

                  return (
                    <button
                      key={page}
                      type="button"
                      onClick={() => setOrderPage(page)}
                      className={`h-10 min-w-10 rounded-xl px-3 text-sm font-black ${
                        orderPage === page
                          ? "bg-[#0b6b2b] text-white"
                          : "bg-white text-slate-700 shadow-sm"
                      }`}
                    >
                      {page}
                    </button>
                  );
                })}

                <button
                  type="button"
                  disabled={orderPage >= totalOrderPages}
                  onClick={() =>
                    setOrderPage((prev) => Math.min(totalOrderPages, prev + 1))
                  }
                  className="rounded-xl bg-white px-4 py-2 text-sm font-black text-slate-700 shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Sau
                </button>
              </div>
            </div>
          </>
        )}
      </section>
    );
  };

  const renderInventoryTab = () => (
    <div className="space-y-8">
      <section className="rounded-[2rem] bg-white p-5 shadow-xl">
        <div className="mb-5">
          <h2 className="text-2xl font-black text-[#0b6b2b]">
            Nhập hàng / nguyên liệu
          </h2>
          <p className="text-sm text-slate-500">
            Ghi nhận giá vốn để hệ thống ước tính lợi nhuận. Không ảnh hưởng logic đơn hàng cũ.
          </p>
        </div>

        <form
          onSubmit={saveInventoryEntry}
          className="grid gap-3 rounded-2xl bg-green-50 p-4 lg:grid-cols-6"
        >
          <select
            value={inventoryForm.productId}
            onChange={(e) => {
              const productId = e.target.value;
              const product = products.find((item) => item.id === productId);
              setInventoryForm((prev) => ({
                ...prev,
                productId,
                itemName: product ? product.name : prev.itemName,
              }));
            }}
            className="rounded-xl border px-3 py-2 outline-none lg:col-span-2"
          >
            <option value="">Không gắn món / nguyên liệu chung</option>
            {products.map((product) => (
              <option key={product.id} value={product.id}>
                {product.name}
              </option>
            ))}
          </select>

          <input
            value={inventoryForm.itemName}
            onChange={(e) =>
              setInventoryForm((prev) => ({ ...prev, itemName: e.target.value }))
            }
            className="rounded-xl border px-3 py-2 outline-none lg:col-span-1"
            placeholder="Tên nguyên liệu / món nhập"
          />

          <input
            value={inventoryForm.qty}
            onChange={(e) =>
              setInventoryForm((prev) => ({ ...prev, qty: e.target.value }))
            }
            className="rounded-xl border px-3 py-2 outline-none lg:col-span-1"
            inputMode="numeric"
            placeholder="Số lượng"
          />

          <input
            value={inventoryForm.unitCost}
            onChange={(e) =>
              setInventoryForm((prev) => ({ ...prev, unitCost: e.target.value }))
            }
            className="rounded-xl border px-3 py-2 outline-none lg:col-span-1"
            inputMode="numeric"
            placeholder="Đơn giá nhập"
          />

          <input
            value={inventoryForm.note}
            onChange={(e) =>
              setInventoryForm((prev) => ({ ...prev, note: e.target.value }))
            }
            className="rounded-xl border px-3 py-2 outline-none lg:col-span-1"
            placeholder="Ghi chú"
          />

          <button
            type="submit"
            disabled={inventorySaving}
            className="rounded-xl bg-orange-500 px-4 py-3 font-black text-white disabled:opacity-60 lg:col-span-6"
          >
            {inventorySaving ? "Đang lưu..." : "Lưu phiếu nhập"}
          </button>
        </form>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Tổng tiền nhập", profitStats.purchaseCost],
          ["Doanh thu đơn chưa hủy", profitStats.revenue],
          ["Giá vốn ước tính", profitStats.estimatedCost],
          ["Lợi nhuận gộp", profitStats.grossProfit],
        ].map(([label, value]) => (
          <div key={label} className="rounded-[2rem] bg-white p-5 shadow-lg">
            <p className="text-sm font-bold uppercase text-orange-500">
              {label}
            </p>
            <p className="mt-2 text-2xl font-black text-[#0b6b2b]">
              {formatMoney(value)}
            </p>
          </div>
        ))}
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-[2rem] bg-white p-5 shadow-xl">
          <h3 className="text-xl font-black text-[#0b6b2b]">
            Giá vốn trung bình
          </h3>

          <div className="mt-4 space-y-3">
            {inventorySummary.map((item) => (
              <div
                key={item.id}
                className="rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-100"
              >
                <div className="flex justify-between gap-3">
                  <div>
                    <p className="font-black text-slate-800">{item.name}</p>
                    <p className="text-sm text-slate-500">
                      Số lượng nhập: {item.qty}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-slate-500">
                      Giá vốn TB
                    </p>
                    <p className="font-black text-orange-500">
                      {formatMoney(item.avgCost)}
                    </p>
                  </div>
                </div>
              </div>
            ))}

            {!inventorySummary.length && (
              <p className="rounded-2xl bg-slate-50 p-4 text-slate-500">
                Chưa có dữ liệu nhập hàng.
              </p>
            )}
          </div>
        </div>

        <div className="rounded-[2rem] bg-white p-5 shadow-xl">
          <h3 className="text-xl font-black text-[#0b6b2b]">
            Lịch sử nhập hàng
          </h3>

          {inventoryLoading ? (
            <p className="mt-4 rounded-2xl bg-slate-50 p-4">
              Đang tải nhập hàng...
            </p>
          ) : (
            <div className="mt-4 max-h-[520px] space-y-3 overflow-y-auto pr-1">
              {inventoryEntries.map((entry) => (
                <div
                  key={entry.id}
                  className="rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-100"
                >
                  <div className="flex justify-between gap-3">
                    <div>
                      <p className="font-black text-slate-800">
                        {entry.itemName}
                      </p>
                      <p className="text-sm text-slate-500">
                        {entry.productName
                          ? `Gắn với món: ${entry.productName}`
                          : "Nguyên liệu chung"}
                      </p>
                      {entry.note && (
                        <p className="mt-1 text-xs text-slate-500">
                          Ghi chú: {entry.note}
                        </p>
                      )}
                    </div>

                    <div className="text-right">
                      <p className="font-black text-orange-500">
                        {formatMoney(entry.totalCost)}
                      </p>
                      <p className="text-xs text-slate-500">
                        {entry.qty} x {formatMoney(entry.unitCost)}
                      </p>
                      <p className="text-xs text-slate-400">
                        {entry.createdAtMillis
                          ? new Date(entry.createdAtMillis).toLocaleString("vi-VN")
                          : ""}
                      </p>
                    </div>
                  </div>
                </div>
              ))}

              {!inventoryEntries.length && (
                <p className="rounded-2xl bg-slate-50 p-4 text-slate-500">
                  Chưa có lịch sử nhập hàng.
                </p>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#fff7df] text-slate-900">
      <audio ref={notifyAudioRef} src={orderBellSound} preload="auto" />

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
        <nav className="mb-6 overflow-x-auto rounded-[2rem] bg-white p-2 shadow-lg">
          <div className="flex min-w-max gap-2">
            {tabItems.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`rounded-2xl px-4 py-3 text-sm font-black transition ${
                  activeTab === tab.id
                    ? "bg-[#0b6b2b] text-white shadow-md"
                    : "bg-slate-50 text-slate-600 hover:bg-green-50 hover:text-[#0b6b2b]"
                }`}
              >
                <span className="mr-1">{tab.icon}</span>
                {tab.label}
              </button>
            ))}
          </div>
        </nav>

        {activeTab === "stats" && renderStatsTab()}
        {activeTab === "products" && renderProductsTab()}
        {activeTab === "orders" && renderOrdersTab()}
        {activeTab === "inventory" && renderInventoryTab()}
      </main>

      {selectedOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 py-6 backdrop-blur-sm">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-[2rem] bg-white p-6 shadow-2xl">
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

            <div className="mt-5 space-y-4 text-slate-700">
              <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                <p className="text-sm text-slate-500">
                  Thời gian đặt:{" "}
                  <b className="text-slate-800">
                    {selectedOrder.createdAtMillis
                      ? new Date(selectedOrder.createdAtMillis).toLocaleString("vi-VN")
                      : "Không rõ"}
                  </b>
                </p>
                <p className="mt-1 text-sm text-slate-500">
                  Trạng thái hiện tại:{" "}
                  <span className="inline-block rounded-full bg-orange-100 px-2.5 py-0.5 text-xs font-bold text-orange-700">
                    {statusText[selectedOrder.status] || selectedOrder.status}
                  </span>
                </p>
              </div>

              <div className="rounded-2xl border border-blue-100 bg-blue-50/50 p-4">
                <h4 className="mb-2 text-xs font-black uppercase tracking-wider text-blue-900">
                  Thông tin giao hàng
                </h4>
                <div className="space-y-1.5 text-sm">
                  <p>
                    Khách hàng:{" "}
                    <b className="text-base text-slate-900">
                      {selectedOrder.customer?.name || "Không có tên"}
                    </b>
                  </p>
                  <p>
                    Số điện thoại:{" "}
                    <a
                      href={`tel:${selectedOrder.customer?.phone}`}
                      className="font-bold text-blue-600 underline hover:text-blue-800"
                    >
                      {selectedOrder.customer?.phone || "Không có SĐT"}
                    </a>
                  </p>
                  <p className="leading-relaxed">
                    Địa chỉ:{" "}
                    <b className="text-slate-900">
                      {selectedOrder.customer?.address || "Không có địa chỉ"}
                    </b>
                  </p>
                </div>
              </div>

              <div className="rounded-2xl border border-green-100 bg-green-50/40 p-4">
                <h4 className="mb-2 text-xs font-black uppercase tracking-wider text-green-900">
                  Tùy chọn khẩu vị & Ghi chú
                </h4>
                <p className="text-sm">
                  Ghi chú:{" "}
                  <span
                    className={`font-medium ${
                      selectedOrder.note
                        ? "rounded bg-yellow-100 px-1.5 py-0.5 text-slate-900"
                        : "italic text-slate-400"
                    }`}
                  >
                    {selectedOrder.note || "Không có ghi chú"}
                  </span>
                </p>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <h4 className="mb-3 text-xs font-black uppercase tracking-wider text-slate-900">
                  Danh sách món ({selectedOrder.items?.length || 0})
                </h4>
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
                        {item.sweetness && (
                          <p className="text-xs text-slate-500">
                            {item.sweetness}
                            {item.milkSurcharge > 0 ? " (+2k/ly)" : ""}
                          </p>
                        )}
                        <p className="text-xs text-slate-500">
                          Đá: {item.ice || "Bình thường"}
                        </p>
                      </div>
                      <b className="text-sm text-slate-900">
                        {formatMoney(item.total)}
                      </b>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border border-orange-100 bg-orange-50 p-4">
                <h4 className="mb-2 text-xs font-black uppercase tracking-wider text-orange-900">
                  Chi tiết thanh toán
                </h4>
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
                    <span>
                      {selectedOrder.pricing?.milkSurchargeTotal
                        ? `+${formatMoney(selectedOrder.pricing.milkSurchargeTotal)}`
                        : "0đ"}
                    </span>
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
                    <span className="text-2xl">
                      {formatMoney(selectedOrder.pricing?.total)}
                    </span>
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
