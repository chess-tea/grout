module Log = (val Timber.Log.withNamespace("Grout"));

module type Config = {
  type t;
  let default: t;
};

module Make = (Config: Config) => {
  module Private = {
    let count = ref(0);
    let cleanupFrequency = 100;
    let activeRoute = ref(Config.default);
    let handlers: ref(list(ref(option(Config.t => unit)))) = ref([]);
    let addHandler = handler => {
      handlers.contents = [handler, ...handlers.contents];
      count.contents = count.contents + 1;
      if (count.contents mod cleanupFrequency === cleanupFrequency - 1) {
        handlers.contents =
          List.filter(handler => handler.contents != None, handlers.contents);
      };
    };
  };

  type t = Config.t;

  let getRoute = () => Private.activeRoute.contents;
  let useRoute = () => {
    Log.debug("Use Route");
    let%hook (route, updateRoute) = Revery.UI.Hooks.state(getRoute());
    let handler = ref(Some(route => updateRoute(_ => route)));
    Private.addHandler(handler);
    let setRoute = route => {
      Log.debug("Set Route");
      Private.activeRoute.contents = route;
      List.iter(
        handler =>
          switch (handler.contents) {
          | Some(handler) => handler(route)
          | None => ()
          },
        Private.handlers.contents,
      );
      ();
    };

    let%hook () =
      Revery.UI.Hooks.effect(
        OnMount,
        () => {
          let dispose = () => {
            Log.debug("Dispose handler");
            handler.contents = None;
          };
          Some(dispose);
        },
      );

    (route, setRoute);
  };
};
let x = 42;
