/**
 * Domain chrome for DinextTable toolbar — same visuals as former `.budget-controls`.
 * Mount once into stable custom host (id reused across toolbar refreshes).
 *
 * @param {Form} frm
 */
export function buildToolbarItems(frm) {
	return [
		{
			id: "pl-controls",
			type: "custom",
			render: ({ host }) => {
				const mount = dinext_projects_pl.mount_budget_toolbar_controls;
				if (typeof mount !== "function") {
					console.error("[Project P&L] mount_budget_toolbar_controls missing");
					return;
				}
				mount(frm, $(host));
			},
		},
	];
}
