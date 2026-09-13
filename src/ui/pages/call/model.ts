import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

interface CallState {
  selectedAlias: string | null;
  selectedTool: string | null;
}

const initialState: CallState = {
  selectedAlias: null,
  selectedTool: null,
};

const callSlice = createSlice({
  name: "call",
  initialState,
  reducers: {
    selectServer(state, action: PayloadAction<string>) {
      state.selectedAlias = action.payload;
      state.selectedTool = null;
    },
    selectTool(state, action: PayloadAction<string>) {
      state.selectedTool = action.payload;
    },
  },
  selectors: {
    selectSelectedAlias: (state) => state.selectedAlias,
    selectSelectedTool: (state) => state.selectedTool,
  },
});

export const { selectServer, selectTool } = callSlice.actions;
export const { selectSelectedAlias, selectSelectedTool } = callSlice.selectors;
export default callSlice.reducer;
