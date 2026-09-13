import { createSlice } from "@reduxjs/toolkit";

/**
 * Placeholder slice -- this screen has no state yet. Exists so the store's
 * static reducer map (see @/ui/store.ts) doesn't need touching again when
 * this screen is built out.
 */
const testSlice = createSlice({
  name: "test",
  initialState: {},
  reducers: {},
});

export default testSlice.reducer;
