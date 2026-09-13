import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

interface TestState {
  /** Alias picked from the server-filter row; null until one is chosen. */
  alias: string | null;
  /** Name of the failed check whose drawer is open; at most one at a time. */
  expandedCheck: string | null;
}

const initialState: TestState = {
  alias: null,
  expandedCheck: null,
};

const testSlice = createSlice({
  name: "test",
  initialState,
  reducers: {
    setAlias(state, action: PayloadAction<string>) {
      state.alias = action.payload;
      state.expandedCheck = null;
    },
    toggleExpandedCheck(state, action: PayloadAction<string>) {
      state.expandedCheck = state.expandedCheck === action.payload ? null : action.payload;
    },
  },
  selectors: {
    selectAlias: (state) => state.alias,
    selectExpandedCheck: (state) => state.expandedCheck,
  },
});

export const { setAlias, toggleExpandedCheck } = testSlice.actions;
export const { selectAlias, selectExpandedCheck } = testSlice.selectors;
export default testSlice.reducer;
