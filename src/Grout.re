module Log = (val Timber.Log.withNamespace("Grout"));

module type Config = {
  type t;
  let default: t;
  let equals: (t, t) => bool;
};

module Make = (Config: Config) => {
  module RouterState = Store.Make({
    type state = Config.t;
    type action = | SetRoute(Config.t);
    let initialState = () => Config.default;
    let reducer = (action, _prevState) => {
      switch (action) {
      | SetRoute(nextRoute) => nextRoute
      };
    };
    let equals = (==);
  });

  let useRoute = () => {
    let%hook (route, dispatch) => RouterState.useState();
    let setRoute = (route) => dispatch(SetRoute(route));
    (route, setRoute);
  };
};

let x = 42;
