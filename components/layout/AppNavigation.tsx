"use client";

import { useState } from "react";
import type { UsuarioAtual } from "@/lib/auth/session";
import { Header } from "./Header";
import { Sidebar } from "./Sidebar";

/** O cabeçalho abre o menu mobile; a navegação desktop permanece independente. */
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
