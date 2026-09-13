import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

export type TrafficView = "live" | "history";
/** "all" | "errors" | a specific alias name. */
export type TrafficFilter = "all" | "errors" | (string & {});
export type StreamStatus = "connecting" | "live" | "waiting";

interface TrafficState {
  view: TrafficView;
  filter: TrafficFilter;
  expandedId: string | null;
  streamStatus: StreamStatus;
}

const initialState: TrafficState = {
  view: "live",
  filter: "all",
  expandedId: null,
  streamStatus: "connecting",
};

const trafficSlice = createSlice({
  name: "traffic",
  initialState,
  reducers: {
    setView(state, action: PayloadAction<TrafficView>) {
      state.view = action.payload;
    },
    setFilter(state, action: PayloadAction<TrafficFilter>) {
      state.filter = action.payload;
      // Prototype semantics: selecting a filter closes any expanded row.
      state.expandedId = null;
    },
    toggleExpanded(state, action: PayloadAction<string>) {
      state.expandedId = state.expandedId === action.payload ? null : action.payload;
    },
    setStreamStatus(state, action: PayloadAction<StreamStatus>) {
      state.streamStatus = action.payload;
    },
  },
  selectors: {
    selectView: (state) => state.view,
    selectFilter: (state) => state.filter,
    selectExpandedId: (state) => state.expandedId,
    selectStreamStatus: (state) => state.streamStatus,
  },
});

export const { setView, setFilter, toggleExpanded, setStreamStatus } = trafficSlice.actions;
export const { selectView, selectFilter, selectExpandedId, selectStreamStatus } = trafficSlice.selectors;
export default trafficSlice.reducer;
