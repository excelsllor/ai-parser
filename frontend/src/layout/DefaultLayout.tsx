import { Outlet } from "react-router-dom"

import Header from "@/components/layout/Header/Header"
import Footer from "@/components/layout/Footer/Footer"

export default function DefaultLayout() {
  return (
    <>
      <Header />
      <Outlet />
      <Footer />
    </>
  )
}
