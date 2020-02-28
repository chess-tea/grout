
module Log = (val Timber.Log.withNamespace("Grout"));

type t = {push: Route.t => unit};

module Private = {
  let mainRouter: ref(option(t)) = ref(None);
  let dummyRouter = {push: _ => ()};
};

let get = () => {
  switch (Private.mainRouter.contents) {
  | Some(router) => router
  | None =>
    Log.error(
      "Router is not initialized or has been disposed. Using dummy router.",
    );
    Private.dummyRouter;
  };
};

let init = (update, route) => {
  Log.info("Initializing Router");
  switch (Private.mainRouter.contents) {
  | Some(router) => Log.warn("Router already initialized. Doing nothing.")
  | None =>
    let push = url => {
      let router = get();
      // TODO: Log the routes somehow.
      // Log.infof(m => m("Activating: %s", url));
      let element = route(router, url);
      update(element);
    };

    Private.mainRouter.contents = Some({push: push});
  };
};
