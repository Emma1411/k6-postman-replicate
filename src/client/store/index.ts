import { configureStore } from "@reduxjs/toolkit";
import editor from "@/client/features/requests/editor-slice";
import environments from "@/client/features/requests/environments-slice";
import load from "@/client/features/load/load-slice";
import config from "./config-slice";

export const makeStore = () => configureStore({ reducer: { config, editor, environments, load } });

export type AppStore = ReturnType<typeof makeStore>;
export type RootState = ReturnType<AppStore["getState"]>;
export type AppDispatch = AppStore["dispatch"];