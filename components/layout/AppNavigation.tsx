"use client";

import { useState } from "react";
import type { UsuarioAtual } from "@/lib/auth/session";
import { Header } from "./Header";
import { Sidebar } from "./Sidebar";

/** A barra superior e a navegacao inferior compartilham o mesmo menu mobile. */
export function AppNavigation({ usuario }: { usuario: UsuarioAtual }) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <>
      <Sidebar usuario={usuario} menuOpen={menuOpen} onMenuOpenChange={setMenuOpen} />
      <Header
        usuario={usuario}
        menuOpen={menuOpen}
        onMenuOpenChange={setMenuOpen}
      />
    </>
  );
}
