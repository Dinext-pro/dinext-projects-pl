import { mount_toolbar_controls } from "./controls.js";

/**
 * Domain chrome for DinextTable toolbar — same pattern as WE `.work-efforts-controls`.
 *
 * @param {Form} frm
 */
export function buildToolbarItems(frm) {
	return [
		{
			id: "pl-controls",
			type: "custom",
			render: ({ host }) => {
				mount_toolbar_controls(frm, $(host));
			},
		},
	];
}
