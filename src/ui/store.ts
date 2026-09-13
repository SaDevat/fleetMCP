import { configureStore } from "@reduxjs/toolkit";
import { api } from "@/ui/shared/api/base.ts";
import trafficReducer from "@/ui/pages/traffic/model.ts";
import serversReducer from "@/ui/pages/servers/model.ts";
import callReducer from "@/ui/pages/call/model.ts";
import inspectReducer from "@/ui/pages/inspect/model.ts";
import testReducer from "@/ui/pages/test/model.ts";

// Static reducer map: every page's slice is listed once here, so a screen
// built after this one only ever edits its own pages/<screen>/ files.
export const store = configureStore({
  reducer: {
    [api.reducerPath]: api.reducer,
    traffic: trafficReducer,
    servers: serversReducer,
    call: callReducer,
    inspect: inspectReducer,
    test: testReducer,
  },
  middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(api.middleware),
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
