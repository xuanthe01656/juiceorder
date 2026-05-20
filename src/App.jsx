import React, { useMemo, useRef, useState } from "react";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";

import { db } from "./firebase";

import heroBanner from "./assets/images/hero_banner.png";
import duaHauImg from "./assets/images/product_dua_hau.png";
import caChuaImg from "./assets/images/product_ca_chua.png";
import thomImg from "./assets/images/product_thom.png";
import oiImg from "./assets/images/product_oi.png";
import caRotImg from "./assets/images/product_ca_rot.png";
import taoImg from "./assets/images/product_tao.png";
import camImg from "./assets/images/product_cam.png";
import miaImg from "./assets/images/product_mia.png";
import freeShipImg from "./assets/images/free_ship.png";
import comboTietKiemImg from "./assets/images/combo_tiet_kiem.png";
import comboHealthyImg from "./assets/images/combo_healthy.png";

const PHONE_ZALO = "0332420710";
const SHOP_ADDRESS = "317 Âu Cơ, Hòa Khánh Bắc, Liên Chiểu, Đà Nẵng";
const SHOP_LOCATION = {
  lat: 16.0770582,
  lon: 108.1369375,
};

const FREE_SHIP_RADIUS_KM = 3;
const ORDER_STORAGE_KEY = "nha_mit_order_ids";
const ORDER_SEARCH_KEY = "nha_mit_last_order_search";
const CANCEL_LIMIT_MS = 5 * 60 * 1000;

const products = [
  {
    id: "dua-hau",
    name: "Dưa hấu",
    price: 12000,
    desc: "Thơm mát, giải nhiệt, giàu vitamin",
    image: duaHauImg,
  },
  {
    id: "ca-chua",
    name: "Cà chua",
    price: 12000,
    desc: "Giàu lycopene, tốt cho tim mạch, đẹp da",
    image: caChuaImg,
  },
  {
    id: "thom",
    name: "Thơm",
    price: 15000,
    desc: "Giàu vitamin C, hỗ trợ tiêu hóa",
    image: thomImg,
  },
  {
    id: "oi",
    name: "Ổi",
    price: 15000,
    desc: "Giàu vitamin C, tăng sức đề kháng",
    image: oiImg,
  },
  {
    id: "ca-rot",
    name: "Cà rốt",
    price: 15000,
    desc: "Tốt cho mắt, đẹp da, tăng đề kháng",
    image: caRotImg,
  },
  {
    id: "tao",
    name: "Táo",
    price: 18000,
    desc: "Giàu chất chống oxy hóa, tốt cho tim mạch",
    image: taoImg,
  },
  {
    id: "cam",
    name: "Cam",
    price: 15000,
    desc: "Giàu vitamin C, tăng cường miễn dịch",
    image: camImg,
  },
  {
    id: "mia",
    name: "Mía",
    price: 12000,
    desc: "Thanh mát, tự nhiên, giàu khoáng chất",
    image: miaImg,
  },
];

const defaultForm = {
  name: "",
  phone: "",
  address: "",
  sugar: "Ít đường",
  ice: "Ít đá",
  note: "",
};

const formatMoney = (value) => {
  return Number(value || 0).toLocaleString("vi-VN") + "đ";
};

const validatePhone = (phone) => {
  const cleaned = phone.replace(/\s/g, "");
  return /^(0|\+84)[0-9]{8,10}$/.test(cleaned);
};

const buildZaloUrl = (phone, message) => {
  return `https://zalo.me/${phone}?text=${encodeURIComponent(message)}`;
};
const copyTextFallback = async (text) => {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }

    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();

    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);

    return ok;
  } catch (error) {
    console.error("Copy failed:", error);
    return false;
  }
};
const calculateDistanceKm = (from, to) => {
  const R = 6371;
  const dLat = ((to.lat - from.lat) * Math.PI) / 180;
  const dLon = ((to.lon - from.lon) * Math.PI) / 180;

  const lat1 = (from.lat * Math.PI) / 180;
  const lat2 = (to.lat * Math.PI) / 180;

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLon / 2) *
      Math.sin(dLon / 2) *
      Math.cos(lat1) *
      Math.cos(lat2);

  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const searchAddressApi = async (keyword) => {
  const query = `${keyword}, Đà Nẵng, Việt Nam`;

  const url =
    `https://nominatim.openstreetmap.org/search` +
    `?format=jsonv2` +
    `&addressdetails=1` +
    `&limit=5` +
    `&countrycodes=vn` +
    `&accept-language=vi` +
    `&q=${encodeURIComponent(query)}`;

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error("Không thể tìm địa chỉ");
  }

  return response.json();
};

export default function App() {
  const [cart, setCart] = useState({});
  const [form, setForm] = useState(defaultForm);
  const [copied, setCopied] = useState(false);
  const addressInputRef = useRef(null);
  const [addressKeyword, setAddressKeyword] = useState("");
  const [addressSuggestions, setAddressSuggestions] = useState([]);
  const [addressLoading, setAddressLoading] = useState(false);
  const [deliveryInfo, setDeliveryInfo] = useState({
    distanceKm: null,
    isFreeShip: false,
  });
  const [submitLoading, setSubmitLoading] = useState(false);
  const [cancelLoading, setCancelLoading] = useState(false);
  const [orderSearchCode, setOrderSearchCode] = useState(
    () => localStorage.getItem(ORDER_SEARCH_KEY) || ""
  );
  const [searchedOrder, setSearchedOrder] = useState(null);
  const [orderModalOpen, setOrderModalOpen] = useState(false);
  const [orderSearchLoading, setOrderSearchLoading] = useState(false);

  const order = useMemo(() => {
    const items = products
      .map((product) => ({
        ...product,
        qty: cart[product.id] || 0,
      }))
      .filter((item) => item.qty > 0);

    const qtyTotal = items.reduce((sum, item) => sum + item.qty, 0);
    const subtotal = items.reduce(
      (sum, item) => sum + item.price * item.qty,
      0
    );

    let discount = 0;
    let discountLabel = "Chưa áp dụng";

    if (qtyTotal >= 6) {
      const allPrices = items
        .flatMap((item) => Array(item.qty).fill(item.price))
        .sort((a, b) => a - b);
      const first6 = allPrices.slice(0, 6);
      const remaining = allPrices.slice(6);
      const first6Original = first6.reduce((sum, price) => sum + price, 0);
      discount = Math.max(0, first6Original - 79000);
      discountLabel =
        qtyTotal === 6
          ? "Combo healthy 6 ly = 79K"
          : `Combo healthy 6 ly = 79K + ${remaining.length} ly tính thêm`;
    } else if (qtyTotal >= 3 && qtyTotal <= 5) {
      discount = 5000;
      discountLabel = "Combo 3-5 ly giảm 5K";
    }

    let shipping = 0;
    let shippingLabel = "Chưa chọn địa chỉ";

    const distance = deliveryInfo.distanceKm;

    if (qtyTotal === 0) {
      shipping = 0;
      shippingLabel = "Chưa có đơn";
    } else if (distance === null) {
      shipping = 0;
      shippingLabel = "Chưa xác định khoảng cách";
    } else if (distance <= 3) {
      if (qtyTotal >= 5) {
        shipping = 0;
        shippingLabel = `Free ship trong ${FREE_SHIP_RADIUS_KM}km cho đơn từ 5 ly`;
      } else {
        shipping = 3000;
        shippingLabel = "Phí ship nội khu dưới 3km";
      }
    } else if (distance > 3 && distance <= 5) {
      shipping = 10000;
      shippingLabel = "Phí ship khu vực 3-5km";
    } else {
      shipping = 20000;
      shippingLabel = "Phí ship ngoài 5km";
    }

    const total = Math.max(0, subtotal - discount + shipping);

    return {
      items,
      qtyTotal,
      subtotal,
      discount,
      discountLabel,
      shipping,
      shippingLabel,
      total,
    };
  }, [cart, deliveryInfo]);

  const changeQty = (productId, delta) => {
    setCart((prev) => {
      const currentQty = prev[productId] || 0;
      const nextQty = Math.max(0, currentQty + delta);

      if (nextQty === 0) {
        const nextCart = { ...prev };
        delete nextCart[productId];
        return nextCart;
      }

      return {
        ...prev,
        [productId]: nextQty,
      };
    });

    setCopied(false);
  };

  const clearCart = () => {
    setCart({});
    setCopied(false);
  };
  const resetOrderForm = () => {
    setCart({});
    setForm(defaultForm);
    setAddressKeyword("");
    setAddressSuggestions([]);
    setDeliveryInfo({
      distanceKm: null,
      isFreeShip: false,
    });
    setCopied(false);

    setTimeout(() => {
      addressInputRef.current?.focus();
    }, 0);
  };

  const updateForm = (field, value) => {
    setForm((prev) => ({
      ...prev,
      [field]: value,
    }));

    setCopied(false);
  };
  const handleSearchAddress = async () => {
    if (!addressKeyword.trim()) {
      alert("Vui lòng nhập địa chỉ cần tìm.");
      return;
    }

    try {
      setAddressLoading(true);
      const results = await searchAddressApi(addressKeyword);

      if (!results.length) {
        setAddressSuggestions([]);
        alert("Không tìm thấy địa chỉ. Bạn thử nhập rõ hơn, ví dụ: số nhà + tên đường + Đà Nẵng.");
        return;
      }

      setAddressSuggestions(results);
    } catch (error) {
      alert("Không thể tìm địa chỉ lúc này. Vui lòng thử lại.");
    } finally {
      setAddressLoading(false);
    }
  };

  const selectAddress = (place) => {
    const selectedAddress = place.display_name;

    const customerLocation = {
      lat: Number(place.lat),
      lon: Number(place.lon),
    };

    const distanceKm = calculateDistanceKm(SHOP_LOCATION, customerLocation);

    setAddressKeyword(selectedAddress);
    updateForm("address", selectedAddress);

    setDeliveryInfo({
      distanceKm,
      isFreeShip: distanceKm <= FREE_SHIP_RADIUS_KM,
    });

    setAddressSuggestions([]);

    setTimeout(() => {
      addressInputRef.current?.focus();
    }, 0);
  };
  const getCurrentLocation = () => {
    const allow = window.confirm(
      "Website cần dùng vị trí hiện tại của bạn để tính khoảng cách giao hàng từ quán 317 Âu Cơ. Bạn có đồng ý cho phép dùng vị trí không?"
    );

    if (!allow) {
      return;
    }

    if (!navigator.geolocation) {
      alert("Trình duyệt không hỗ trợ GPS.");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const customerLocation = {
          lat: position.coords.latitude,
          lon: position.coords.longitude,
        };

        const distanceKm = calculateDistanceKm(SHOP_LOCATION, customerLocation);

        setDeliveryInfo({
          distanceKm,
          isFreeShip: distanceKm <= FREE_SHIP_RADIUS_KM,
        });

        setTimeout(() => {
          addressInputRef.current?.focus();
        }, 0);

        alert(`Đã xác định vị trí khách hàng: ${distanceKm.toFixed(2)}km từ quán`);
      },
      (error) => {
        console.error(error);

        alert(
          "Không thể lấy vị trí. Hãy bật GPS hoặc cấp quyền vị trí cho trình duyệt."
        );

        setTimeout(() => {
          addressInputRef.current?.focus();
        }, 0);
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0,
      }
    );
  };
  const createOrderMessage = () => {
    const productLines = order.items
      .map((item, index) => {
        return `${index + 1}. ${item.name}: ${item.qty} ly x ${formatMoney(
          item.price
        )} = ${formatMoney(item.qty * item.price)}`;
      })
      .join("\n");

    return `Xin chào Nước ép nhà Mit, mình muốn đặt hàng:
        ${productLines}
        --- THÔNG TIN ĐƠN ---
        Số lượng: ${order.qtyTotal} ly
        Tạm tính: ${formatMoney(order.subtotal)}
        Ưu đãi: -${formatMoney(order.discount)} (${order.discountLabel})
        Ship: ${order.shipping === 0 ? "Free" : formatMoney(order.shipping)}
        Tổng thanh toán: ${formatMoney(order.total)}

        --- THÔNG TIN KHÁCH ---
        Tên: ${form.name.trim()}
        SĐT: ${form.phone.trim()}
        Địa chỉ: ${form.address.trim()}
        Khoảng cách: ${
          deliveryInfo.distanceKm === null
            ? "Chưa xác định"
            : `${deliveryInfo.distanceKm.toFixed(2)}km từ quán`
        }
        Đường: ${form.sugar}
        Đá: ${form.ice}
        Ghi chú: ${form.note.trim() || "Không có"}`;
  };
  const saveOrderToFirebase = async () => {
    const orderData = {
      customer: {
        name: form.name,
        phone: form.phone,
        address: form.address,
      },

      items: order.items.map((item) => ({
        id: item.id,
        name: item.name,
        qty: item.qty,
        price: item.price,
        total: item.qty * item.price,
      })),

      pricing: {
        subtotal: order.subtotal,
        discount: order.discount,
        shipping: order.shipping,
        total: order.total,
      },

      delivery: {
        distanceKm: deliveryInfo.distanceKm,
        isFreeShip: order.shipping === 0,
      },

      options: {
        sugar: form.sugar,
        ice: form.ice,
      },

      note: form.note,
      createdAt: serverTimestamp(),
      createdAtMillis: Date.now(),
      status: "pending",
    };

    const docRef = await addDoc(
      collection(db, "orders"),
      orderData
    );

    return docRef.id;
  };
  const getStoredOrderIds = () => {
    try {
      return JSON.parse(localStorage.getItem(ORDER_STORAGE_KEY)) || [];
    } catch {
      return [];
    }
  };
  
  const saveOrderIdToStorage = (orderId) => {
    const oldIds = getStoredOrderIds();
  
    const nextIds = [
      orderId,
      ...oldIds.filter((id) => id !== orderId),
    ].slice(0, 20);
  
    localStorage.setItem(ORDER_STORAGE_KEY, JSON.stringify(nextIds));
    localStorage.setItem(ORDER_SEARCH_KEY, orderId);
    setOrderSearchCode(orderId);
  };
  
  const getOrderCreatedTime = (orderData) => {
    if (orderData.createdAtMillis) return orderData.createdAtMillis;
    if (orderData.createdAt?.toMillis) return orderData.createdAt.toMillis();
    return Date.now();
  };
  
  const canCancelOrder = (orderData) => {
    const createdTime = getOrderCreatedTime(orderData);
    return Date.now() - createdTime <= CANCEL_LIMIT_MS;
  };
  const sendTelegramNotification = async (message) => {
    const response = await fetch("/api/send-telegram", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text: message,
      }),
    });

    const data = await response.json();

    if (!response.ok || !data.ok) {
      throw new Error(data.message || "Không gửi được Telegram");
    }

    return data;
  };
  const copyOrderMessage = async () => {
    if (!order.items.length) {
      alert("Vui lòng chọn ít nhất 1 ly nước ép.");
      return;
    }

    const copiedOk = await copyTextFallback(createOrderMessage());

    if (copiedOk) {
      setCopied(true);
      alert("Đã copy nội dung đơn hàng.");
    } else {
      alert("Không copy được tự động. Vui lòng thử lại trên HTTPS hoặc localhost.");
    }
  };
  const searchOrderByCode = async () => {
    const code = orderSearchCode.trim();
  
    if (!code) {
      alert("Vui lòng nhập mã đơn.");
      return;
    }
  
    localStorage.setItem(ORDER_SEARCH_KEY, code);
  
    const storedIds = getStoredOrderIds();
  
    if (!storedIds.includes(code)) {
      alert("Mã đơn này không được tạo trên thiết bị này.");
      return;
    }
  
    try {
      setOrderSearchLoading(true);
  
      const orderRef = doc(db, "orders", code);
      const snap = await getDoc(orderRef);
  
      if (!snap.exists()) {
        alert("Không tìm thấy đơn hàng.");
        return;
      }
  
      setSearchedOrder({
        id: snap.id,
        ...snap.data(),
      });
  
      setOrderModalOpen(true);
    } catch (error) {
      console.error(error);
      alert("Không thể tìm đơn hàng lúc này.");
    } finally {
      setOrderSearchLoading(false);
    }
  };
  
  const cancelOrder = async () => {
    if (cancelLoading) return;
    if (!searchedOrder) return;
  
    if (searchedOrder.status === "cancelled") {
      alert("Đơn này đã được hủy trước đó.");
      return;
    }
  
    if (!canCancelOrder(searchedOrder)) {
      alert("Đơn đã quá 5 phút nên không thể hủy.");
      return;
    }
  
    const confirmCancel = window.confirm("Bạn chắc chắn muốn hủy đơn này?");
    if (!confirmCancel) return;
  
    setCancelLoading(true);
  
    try {
      const orderRef = doc(db, "orders", searchedOrder.id);
  
      await updateDoc(orderRef, {
        status: "cancelled",
        cancelledAt: serverTimestamp(),
        cancelledAtMillis: Date.now(),
      });
  
      setSearchedOrder((prev) => ({
        ...prev,
        status: "cancelled",
        cancelledAtMillis: Date.now(),
      }));
  
      alert("Đã hủy đơn thành công.");
    } catch (error) {
      console.error(error);
      alert("Không thể hủy đơn lúc này.");
    } finally {
      setCancelLoading(false);
    }
  };

  const submitOrder = async (event) => {
    event.preventDefault();
  
    if (submitLoading) return;
  
    if (!order.items.length) {
      alert("Vui lòng chọn ít nhất 1 ly nước ép.");
      return;
    }
  
    if (!form.name.trim()) {
      alert("Vui lòng nhập họ tên.");
      return;
    }
  
    if (!form.phone.trim()) {
      alert("Vui lòng nhập số điện thoại.");
      return;
    }
  
    if (!validatePhone(form.phone)) {
      alert("Số điện thoại chưa đúng định dạng. Ví dụ: 0332420710 hoặc +84332420710");
      return;
    }
  
    if (!form.address.trim()) {
      alert("Vui lòng nhập địa chỉ giao hàng.");
      return;
    }
  
    if (deliveryInfo.distanceKm === null) {
      alert("Vui lòng bấm tìm/chọn địa chỉ hoặc dùng GPS để tính khoảng cách giao hàng.");
      return;
    }
  
    setSubmitLoading(true);
  
    try {
      const orderId = await saveOrderToFirebase();
      saveOrderIdToStorage(orderId);
  
      const message = `Mã đơn: ${orderId}\n\n${createOrderMessage()}`;
  
      try {
        await sendTelegramNotification(message);
      } catch (error) {
        console.error(error);
        alert("Đơn đã lưu Firebase nhưng chưa gửi được thông báo Telegram.");
      }
  
      const copiedOk = await copyTextFallback(message);
      setCopied(copiedOk);
  
      if (!copiedOk) {
        alert("Đã lưu đơn nhưng trình duyệt không cho copy tự động.");
      }
  
      alert(`Đặt hàng thành công! Mã đơn: ${orderId}. Chủ quán sẽ liên hệ xác nhận sớm nhất.`);
      resetOrderForm();
    } catch (error) {
      console.error(error);
      alert("Không thể lưu đơn hàng lên Firebase. Vui lòng thử lại.");
    } finally {
      setSubmitLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#fff7df] text-slate-900">
      <header className="relative overflow-hidden bg-gradient-to-br from-lime-100 via-yellow-50 to-orange-50">
        <div className="absolute -left-16 top-10 h-56 w-56 rounded-full bg-orange-200/60 blur-3xl" />
        <div className="absolute -right-16 bottom-10 h-56 w-56 rounded-full bg-lime-200/70 blur-3xl" />

        <div className="relative mx-auto grid max-w-7xl gap-8 px-4 py-8 md:grid-cols-2 md:px-8 lg:py-14">
          <div className="flex flex-col justify-center">
            <p className="mb-3 inline-flex w-fit rounded-full bg-green-100 px-4 py-2 text-sm font-bold text-[#0b6b2b] shadow-sm">
              Ép tươi mỗi ngày - Free ship từ 5 ly trong bán kính 3km
            </p>

            <h1 className="text-5xl font-black uppercase leading-tight text-[#0b6b2b] sm:text-6xl lg:text-7xl">
              Nước ép
              <br />
              <span className="normal-case text-orange-500">nhà Mit</span>
            </h1>

            <p className="mt-4 max-w-xl text-lg font-semibold text-green-800">
              Nước ép nguyên chất, tươi ngon, không chất bảo quản. Không đường,
              đá ít / đá nhiều theo yêu cầu.
            </p>

            <div className="mt-6 flex flex-col gap-3 text-base font-bold sm:flex-row sm:flex-wrap">
              <a
                href={`tel:${PHONE_ZALO}`}
                className="rounded-2xl bg-[#0b6b2b] px-5 py-3 text-center text-white shadow-lg transition hover:bg-green-800"
              >
                Gọi/Zalo: {PHONE_ZALO}
              </a>

              <a
                href="#order"
                className="rounded-2xl border-2 border-[#0b6b2b] bg-white/60 px-5 py-3 text-center text-[#0b6b2b] transition hover:bg-green-50"
              >
                Đặt hàng ngay
              </a>
            </div>

            <p className="mt-4 text-sm font-semibold text-slate-700">
              Địa chỉ: Âu Cơ - Đà Nẵng
            </p>
          </div>

          <div className="relative flex items-center justify-center">
            <img
              src={heroBanner}
              alt="Menu nước ép nhà Mit"
              className="relative z-10 w-full max-w-md rounded-[2rem] object-contain shadow-2xl ring-4 ring-white/70"
            />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8 md:px-8">
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          {
            icon: "🌿",
            title: "Nguyên chất",
            text: "Không chất bảo quản",
            bg: "from-green-50 to-lime-100",
          },
          {
            icon: "🍃",
            title: "Không đường",
            text: "Theo yêu cầu từng món",
            bg: "from-emerald-50 to-green-100",
          },
          {
            icon: "🥤",
            title: "Ép tươi",
            text: "Làm mới mỗi ngày",
            bg: "from-orange-50 to-yellow-100",
          },
          {
            icon: "💚",
            title: "Tốt cho sức khỏe",
            text: "Giàu vitamin tự nhiên",
            bg: "from-lime-50 to-green-100",
          },
        ].map((item) => (
          <div
            key={item.title}
            className={`group relative overflow-hidden rounded-[2rem] border border-green-200 bg-gradient-to-br ${item.bg} p-5 shadow-md transition duration-300 hover:-translate-y-1 hover:shadow-xl`}
          >
            <div className="absolute -right-6 -top-6 h-24 w-24 rounded-full bg-white/50 blur-xl transition group-hover:scale-125" />

            <div className="relative flex items-center gap-4">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white text-3xl shadow-sm ring-1 ring-green-100">
                {item.icon}
              </div>

              <div>
                <h3 className="text-lg font-black uppercase tracking-wide text-[#0b6b2b]">
                  {item.title}
                </h3>
                <p className="mt-1 text-sm font-semibold text-slate-600">
                  {item.text}
                </p>
              </div>
            </div>
          </div>
        ))}
      </section>
      <section className="mt-8 rounded-[2rem] border border-green-200 bg-white p-5 shadow-lg sm:p-6">
        <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-end">
          <div>
            <p className="text-sm font-bold uppercase tracking-wide text-orange-500">
              Theo dõi đơn hàng
            </p>
            <h2 className="mt-1 text-2xl font-black text-[#0b6b2b]">
              Tra cứu đơn đã đặt trên thiết bị này
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Nhập mã đơn để xem trạng thái. Bạn có thể hủy đơn trong vòng 5 phút sau khi đặt.
            </p>
          </div>

          <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
            <input
              value={orderSearchCode}
              onChange={(event) => {
                setOrderSearchCode(event.target.value);
                localStorage.setItem(ORDER_SEARCH_KEY, event.target.value);
              }}
              className="w-full rounded-2xl border border-green-200 px-4 py-3 font-bold outline-none transition focus:border-[#0b6b2b] focus:ring-2 focus:ring-green-100 sm:min-w-80"
              placeholder="Nhập mã đơn ..."
            />

            <button
              type="button"
              onClick={searchOrderByCode}
              disabled={orderSearchLoading}
              className="rounded-2xl bg-[#0b6b2b] px-6 py-3 font-black uppercase text-white shadow-lg transition hover:bg-green-800 disabled:opacity-60"
            >
              {orderSearchLoading ? "Đang tìm..." : "Tìm đơn"}
            </button>
          </div>
        </div>
      </section>
        <section className="mt-10">
          <div className="mb-6 text-center">
            <h2 className="inline-block rounded-2xl bg-[#0b6b2b] px-8 py-3 text-3xl font-black uppercase text-white shadow-lg">
              Menu nước ép
            </h2>
            <p className="mx-auto mt-3 max-w-2xl text-sm font-semibold text-slate-600">
              Chọn số lượng từng món. Hệ thống sẽ tự tính combo, phí ship và
              tổng thanh toán.
            </p>
          </div>

          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {products.map((product) => (
              <article
                key={product.id}
                className="overflow-hidden rounded-[2rem] bg-white shadow-lg transition hover:-translate-y-1 hover:shadow-xl"
              >
                <div className="bg-orange-50 p-3">
                  <img
                    src={product.image}
                    alt={product.name}
                    className="h-56 w-full rounded-[1.5rem] object-contain object-center"
                    loading="lazy"
                  />
                </div>

                <div className="p-5 text-center">
                  <h3 className="text-2xl font-black uppercase text-orange-500">
                    {product.name}
                  </h3>

                  <p className="mt-2 min-h-10 text-sm text-slate-600">
                    {product.desc}
                  </p>

                  <div className="mx-auto mt-4 w-fit rounded-xl bg-orange-500 px-5 py-2 text-2xl font-black text-white">
                    {formatMoney(product.price).replace("đ", "")}/LY
                  </div>

                  <div className="mt-4 flex items-center justify-center gap-2">
                    <button
                      type="button"
                      onClick={() => changeQty(product.id, -1)}
                      className="h-10 w-10 rounded-full bg-slate-100 text-xl font-black transition hover:bg-slate-200"
                    >
                      -
                    </button>

                    <span className="w-10 text-xl font-black">
                      {cart[product.id] || 0}
                    </span>

                    <button
                      type="button"
                      onClick={() => changeQty(product.id, 1)}
                      className="h-10 w-10 rounded-full bg-[#0b6b2b] text-xl font-black text-white transition hover:bg-green-800"
                    >
                      +
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="mt-10 grid gap-5 md:grid-cols-3">
          <img
            src={freeShipImg}
            alt="Free ship"
            className="h-full w-full rounded-[2rem] object-contain shadow-lg"
          />
          <img
            src={comboTietKiemImg}
            alt="Combo tiết kiệm"
            className="h-full w-full rounded-[2rem] object-contain shadow-lg"
          />
          <img
            src={comboHealthyImg}
            alt="Combo healthy"
            className="h-full w-full rounded-[2rem] object-contain shadow-lg"
          />
        </section>

        <section id="order" className="mt-12 grid gap-8 lg:grid-cols-[1.1fr_.9fr]">
          <form
            onSubmit={submitOrder}
            className="rounded-[2rem] bg-white p-5 shadow-xl sm:p-8"
          >
            <h2 className="text-3xl font-black text-[#0b6b2b]">
              Thông tin đặt hàng
            </h2>

            <p className="mt-2 text-slate-600">
              Sau khi đặt hàng, hệ thống sẽ lưu đơn và gửi thông báo cho chủ quán.
              Chủ quán sẽ liên hệ xác nhận sớm nhất.
            </p>

            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block font-bold">Họ tên</label>
                <input
                  value={form.name}
                  onChange={(event) => updateForm("name", event.target.value)}
                  required
                  className="w-full rounded-2xl border px-4 py-3 outline-none transition focus:border-[#0b6b2b] focus:ring-2 focus:ring-green-100"
                  placeholder="Nhập họ tên"
                />
              </div>

              <div>
                <label className="mb-1 block font-bold">Số điện thoại</label>
                <input
                  value={form.phone}
                  onChange={(event) => updateForm("phone", event.target.value)}
                  required
                  inputMode="tel"
                  className="w-full rounded-2xl border px-4 py-3 outline-none transition focus:border-[#0b6b2b] focus:ring-2 focus:ring-green-100"
                  placeholder="Ví dụ: 0332420710"
                />
              </div>
            </div>

            <div className="mt-4">
              <label className="mb-1 block font-bold">Địa chỉ giao hàng</label>

              <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
                <input
                  ref={addressInputRef}
                  value={addressKeyword}
                  onChange={(event) => {
                    setAddressKeyword(event.target.value);
                    updateForm("address", event.target.value);

                    setDeliveryInfo({
                      distanceKm: null,
                      isFreeShip: false,
                    });
                  }}
                  required
                  className="w-full rounded-2xl border px-4 py-3 outline-none transition focus:border-[#0b6b2b] focus:ring-2 focus:ring-green-100"
                  placeholder="Ví dụ: 317 Âu Cơ, Liên Chiểu"
                />

                <button
                  type="button"
                  onClick={handleSearchAddress}
                  disabled={addressLoading}
                  className="rounded-2xl bg-[#0b6b2b] px-5 py-3 font-black text-white transition hover:bg-green-800 disabled:opacity-60"
                >
                  {addressLoading ? "Đang tìm..." : "Tìm"}
                </button>

                <button
                  type="button"
                  onClick={getCurrentLocation}
                  className="rounded-2xl bg-orange-500 px-5 py-3 font-black text-white transition hover:bg-orange-600"
                >
                  GPS
                </button>
              </div>

              {addressSuggestions.length > 0 && (
                <div className="mt-3 overflow-hidden rounded-2xl border bg-white shadow-lg">
                  {addressSuggestions.map((place) => (
                    <button
                      key={place.place_id}
                      type="button"
                      onClick={() => selectAddress(place)}
                      className="block w-full border-b px-4 py-3 text-left text-sm hover:bg-green-50 last:border-b-0"
                    >
                      {place.display_name}
                    </button>
                  ))}
                </div>
              )}

              {deliveryInfo.distanceKm !== null && (
                <div
                  className={`mt-3 rounded-2xl p-4 text-sm font-bold ${
                    deliveryInfo.isFreeShip
                      ? "bg-green-50 text-[#0b6b2b]"
                      : "bg-orange-50 text-orange-600"
                  }`}
                >
                  Khoảng cách từ quán {SHOP_ADDRESS}: {deliveryInfo.distanceKm.toFixed(2)}km.
                  {order.shipping === 0
                    ? " Đơn này được miễn phí giao hàng."
                    : ` Phí ship hiện tại: ${formatMoney(order.shipping)}.`}
                </div>
              )}
            </div>

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block font-bold">Đường</label>
                <select
                  value={form.sugar}
                  onChange={(event) => updateForm("sugar", event.target.value)}
                  className="w-full rounded-2xl border px-4 py-3 outline-none transition focus:border-[#0b6b2b] focus:ring-2 focus:ring-green-100"
                >
                  <option>Ít đường</option>
                  <option>Không đường</option>
                  <option>Bình thường</option>
                </select>
              </div>

              <div>
                <label className="mb-1 block font-bold">Đá</label>
                <select
                  value={form.ice}
                  onChange={(event) => updateForm("ice", event.target.value)}
                  className="w-full rounded-2xl border px-4 py-3 outline-none transition focus:border-[#0b6b2b] focus:ring-2 focus:ring-green-100"
                >
                  <option>Ít đá</option>
                  <option>Nhiều đá</option>
                  <option>Không đá</option>
                  <option>Bình thường</option>
                </select>
              </div>
            </div>

            <div className="mt-4">
              <label className="mb-1 block font-bold">Ghi chú</label>
              <textarea
                value={form.note}
                onChange={(event) => updateForm("note", event.target.value)}
                rows={3}
                className="w-full rounded-2xl border px-4 py-3 outline-none transition focus:border-[#0b6b2b] focus:ring-2 focus:ring-green-100"
                placeholder="Ví dụ: giao trước 10h, để riêng từng ly..."
              />
            </div>

            {copied && (
              <div className="mt-4 rounded-2xl bg-green-50 p-4 text-sm font-bold text-[#0b6b2b]">
                Đã copy nội dung đơn hàng. Nếu Zalo không tự điền tin nhắn, bạn
                chỉ cần dán vào khung chat.
              </div>
            )}

            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              <button
                type="button"
                onClick={copyOrderMessage}
                className="rounded-2xl border-2 border-[#0b6b2b] px-6 py-4 text-lg font-black uppercase text-[#0b6b2b] transition hover:bg-green-50"
              >
                Copy đơn
              </button>

              <button
                type="submit"
                disabled={submitLoading}
                className="rounded-2xl bg-orange-500 px-6 py-4 text-lg font-black uppercase text-white shadow-lg transition hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submitLoading ? "Đang đặt..." : "Đặt hàng ngay"}
              </button>
              <a
                href={buildZaloUrl(PHONE_ZALO, "")}
                target="_blank"
                rel="noreferrer"
                className="rounded-2xl border-2 border-orange-500 px-6 py-4 text-center text-lg font-black uppercase text-orange-500 transition hover:bg-orange-50"
              >
                Chat Zalo
              </a>
            </div>
          </form>

          <aside className="rounded-[2rem] bg-white p-5 shadow-xl sm:p-8 lg:sticky lg:top-5 lg:self-start">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-3xl font-black text-[#0b6b2b]">
                  Đơn hàng
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  {order.qtyTotal} ly đã chọn
                </p>
              </div>

              {order.items.length > 0 && (
                <button
                  type="button"
                  onClick={clearCart}
                  className="rounded-xl bg-slate-100 px-3 py-2 text-sm font-bold text-slate-600 hover:bg-slate-200"
                >
                  Xóa đơn
                </button>
              )}
            </div>

            <div className="mt-5 space-y-3">
              {!order.items.length ? (
                <p className="rounded-2xl bg-slate-50 p-4 text-slate-500">
                  Chưa có món nào. Hãy bấm dấu + ở menu.
                </p>
              ) : (
                order.items.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center gap-3 rounded-2xl bg-slate-50 p-3"
                  >
                    <img
                      src={item.image}
                      alt={item.name}
                      className="h-16 w-16 rounded-2xl object-contain"
                    />

                    <div className="min-w-0 flex-1">
                      <b className="block truncate">{item.name}</b>
                      <p className="text-sm text-slate-500">
                        {item.qty} ly x {formatMoney(item.price)}
                      </p>
                    </div>

                    <b className="text-right text-sm sm:text-base">
                      {formatMoney(item.qty * item.price)}
                    </b>
                  </div>
                ))
              )}
            </div>

            <div className="mt-5 border-t pt-5 text-lg font-bold">
              <div className="flex justify-between gap-4">
                <span>Tạm tính</span>
                <span>{formatMoney(order.subtotal)}</span>
              </div>

              <div className="mt-2 flex justify-between gap-4 text-[#0b6b2b]">
                <span>Ưu đãi</span>
                <span>-{formatMoney(order.discount)}</span>
              </div>

              <p className="mt-1 text-right text-xs font-semibold text-slate-500">
                {order.discountLabel}
              </p>

              <div className="mt-2 flex justify-between gap-4 text-orange-500">
                <span>Phí ship</span>
                <span>{order.shipping === 0 ? "Free" : formatMoney(order.shipping)}</span>
              </div>

              <p className="mt-1 text-right text-xs font-semibold text-slate-500">
                {order.shippingLabel}
                {deliveryInfo.distanceKm !== null &&
                  ` - ${deliveryInfo.distanceKm.toFixed(2)}km`}
              </p>
              <div className="mt-4 flex justify-between gap-4 rounded-2xl bg-green-50 p-4 text-2xl text-[#0b6b2b]">
                <span>Tổng</span>
                <span>{formatMoney(order.total)}</span>
              </div>
            </div>

            <div className="mt-5 rounded-2xl border border-dashed border-green-500 p-4 text-sm font-semibold text-slate-700">
              Combo: 3 ly bất kỳ giảm 5K. 5 ly bất kỳ free ship. Combo healthy
              6 ly bất kỳ chỉ 79K.
            </div>
          </aside>
        </section>
      </main>

      <footer className="mt-12 bg-[#0b6b2b] px-4 py-8 text-center text-white">
        <h3 className="text-2xl font-black">Nước ép nhà Mit</h3>
        <p className="mt-2">Âu Cơ - Đà Nẵng | SDT/Zalo: {PHONE_ZALO}</p>
        <p className="mt-2 italic">Cảm ơn bạn đã ủng hộ nước ép nhà Mit!</p>
      </footer>
      {orderModalOpen && searchedOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 py-6">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-[2rem] bg-white p-5 shadow-2xl sm:p-7">
            <div className="flex items-start justify-between gap-4 border-b pb-4">
              <div>
                <p className="text-sm font-bold uppercase text-orange-500">
                  Chi tiết đơn hàng
                </p>
                <h3 className="mt-1 text-2xl font-black text-[#0b6b2b]">
                  Mã đơn: {searchedOrder.id}
                </h3>
                <p className="mt-1 text-sm font-semibold text-slate-500">
                  Trạng thái:{" "}
                  <span
                    className={
                      searchedOrder.status === "cancelled"
                        ? "text-red-500"
                        : "text-[#0b6b2b]"
                    }
                  >
                    {searchedOrder.status || "pending"}
                  </span>
                </p>
              </div>

              <button
                type="button"
                onClick={() => setOrderModalOpen(false)}
                className="rounded-full bg-slate-100 px-4 py-2 font-black text-slate-600 hover:bg-slate-200"
              >
                ×
              </button>
            </div>

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <div className="rounded-2xl bg-green-50 p-4">
                <p className="text-sm font-bold text-slate-500">Khách hàng</p>
                <p className="mt-1 font-black text-[#0b6b2b]">
                  {searchedOrder.customer?.name}
                </p>
                <p className="text-sm">{searchedOrder.customer?.phone}</p>
                <p className="mt-2 text-sm text-slate-600">
                  {searchedOrder.customer?.address}
                </p>
              </div>

              <div className="rounded-2xl bg-orange-50 p-4">
                <p className="text-sm font-bold text-slate-500">Thanh toán</p>
                <p className="mt-1 text-sm">
                  Tạm tính: {formatMoney(searchedOrder.pricing?.subtotal)}
                </p>
                <p className="text-sm">
                  Ưu đãi: -{formatMoney(searchedOrder.pricing?.discount)}
                </p>
                <p className="text-sm">
                  Ship:{" "}
                  {searchedOrder.pricing?.shipping === 0
                    ? "Free"
                    : formatMoney(searchedOrder.pricing?.shipping)}
                </p>
                <p className="mt-2 text-xl font-black text-orange-500">
                  Tổng: {formatMoney(searchedOrder.pricing?.total)}
                </p>
              </div>
            </div>

            <div className="mt-5 space-y-3">
              {(searchedOrder.items || []).map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between rounded-2xl bg-slate-50 p-4"
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

            <div className="mt-5 rounded-2xl border border-dashed border-green-300 p-4 text-sm text-slate-600">
              <p>
                Đường: <b>{searchedOrder.options?.sugar}</b>
              </p>
              <p>
                Đá: <b>{searchedOrder.options?.ice}</b>
              </p>
              <p>
                Ghi chú: <b>{searchedOrder.note || "Không có"}</b>
              </p>
            </div>

            <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={cancelOrder}
              disabled={
                cancelLoading ||
                searchedOrder.status === "cancelled" ||
                !canCancelOrder(searchedOrder)
              }
              className="rounded-2xl bg-red-500 px-6 py-4 font-black uppercase text-white shadow-lg transition hover:bg-red-600 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {cancelLoading
                ? "Đang hủy..."
                : searchedOrder.status === "cancelled"
                ? "Đơn đã hủy"
                : canCancelOrder(searchedOrder)
                ? "Hủy đơn"
                : "Quá 5 phút"}
            </button>

              <a
                href={buildZaloUrl(PHONE_ZALO, `Mình cần hỗ trợ đơn ${searchedOrder.id}`)}
                target="_blank"
                rel="noreferrer"
                className="rounded-2xl border-2 border-orange-500 px-6 py-4 text-center font-black uppercase text-orange-500 transition hover:bg-orange-50"
              >
                Chat Zalo hỗ trợ
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}