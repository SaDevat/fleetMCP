import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

export type ServerFormMode = "add" | "edit";

interface ServersState {
  formMode: ServerFormMode | null;
  /** Alias under edit; unused (null) when formMode is "add". */
  formAlias: string | null;
  deleteAlias: string | null;
}

const initialState: ServersState = {
  formMode: null,
  formAlias: null,
  deleteAlias: null,
};

const serversSlice = createSlice({
  name: "servers",
  initialState,
  reducers: {
    openAddForm(state) {
      state.formMode = "add";
      state.formAlias = null;
    },
    openEditForm(state, action: PayloadAction<string>) {
      state.formMode = "edit";
      state.formAlias = action.payload;
    },
    closeForm(state) {
      state.formMode = null;
      state.formAlias = null;
    },
    openDeleteConfirm(state, action: PayloadAction<string>) {
      state.deleteAlias = action.payload;
    },
    closeDeleteConfirm(state) {
      state.deleteAlias = null;
    },
  },
  selectors: {
    selectFormMode: (state) => state.formMode,
    selectFormAlias: (state) => state.formAlias,
    selectDeleteAlias: (state) => state.deleteAlias,
  },
});

export const { openAddForm, openEditForm, closeForm, openDeleteConfirm, closeDeleteConfirm } =
  serversSlice.actions;
export const { selectFormMode, selectFormAlias, selectDeleteAlias } = serversSlice.selectors;
export default serversSlice.reducer;
