// UI Kit entry point. Keeps only the shell of the app and delegates
// edit/view logic to dedicated components for clarity.

import React from "react";
import ForgeReconciler, { useProductContext } from "@forge/react";

import Edit from "./components/Edit";
import View from "./components/View";

const App = () => {
  const context = useProductContext();
  if (!context) {
    return "Loading...";
  }
  return context.extension.entryPoint === "edit" ? <Edit /> : <View />;
};

ForgeReconciler.render(
  <App />
);

