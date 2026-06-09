import { useEffect } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { bootTelegram } from "@/lib/telegram";
import Home from "@/pages/Home";
import Shop from "@/pages/Shop";
import ProductDetail from "@/pages/ProductDetail";
import OrderPage from "@/pages/Order";
import MyOrders from "@/pages/MyOrders";
import Wallet from "@/pages/Wallet";
import TopUp from "@/pages/TopUp";
import Profile from "@/pages/Profile";
import Play from "@/pages/Play";
import Spin from "@/pages/Spin";
import CheckIn from "@/pages/CheckIn";
import Referral from "@/pages/Referral";
import Support from "@/pages/Support";
import AdminDashboard from "@/pages/AdminDashboard";
import AdminOrders from "@/pages/AdminOrders";
import AdminTopups from "@/pages/AdminTopups";
import Notifications from "@/pages/Notifications";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 30_000 },
  },
});

function Routes() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/shop" component={Shop} />
      <Route path="/product/:id" component={ProductDetail} />
      <Route path="/order/:id" component={OrderPage} />
      <Route path="/orders" component={MyOrders} />
      <Route path="/orders/:id" component={MyOrders} />
      <Route path="/wallet" component={Wallet} />
      <Route path="/topup" component={TopUp} />
      <Route path="/profile" component={Profile} />
      <Route path="/play" component={Play} />
      <Route path="/spin" component={Spin} />
      <Route path="/checkin" component={CheckIn} />
      <Route path="/referral" component={Referral} />
      <Route path="/support" component={Support} />
      <Route path="/admin" component={AdminDashboard} />
      <Route path="/admin/orders" component={AdminOrders} />
      <Route path="/admin/topups" component={AdminTopups} />
      <Route path="/notifications" component={Notifications} />
      <Route component={NotFound} />
    </Switch>
  );
}

export default function App() {
  useEffect(() => {
    document.documentElement.classList.add("dark");
    bootTelegram();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
        <Routes />
      </WouterRouter>
    </QueryClientProvider>
  );
}
