module Log = (val Revery.Log.withNamespace("Grout"));

module type Config = {
  type t;
  let default: t;
  let equals: (t, t) => bool;
};

module type Output = {
  type __grout_route;

  open Revery_UI.React;
  let useRoute:
    (
      unit,
      Hooks.t(
        (
          Hooks.State.t(__grout_route),
          Hooks.Effect.t(Revery_UI.React.Hooks.Effect.always)
        ) =>
        'a,
        'b,
      )
    ) =>
    ((__grout_route, __grout_route => unit), Hooks.t('a, 'b));
};

module Make = (Config: Config) : (Output with type __grout_route = Config.t) => {
  type __grout_route = Config.t;
  type state = Config.t;
  type action =
    | SetRoute(Config.t);

  module RouterState =
    GlobalState.Make({
      type nonrec state = state;
      type nonrec action = action;
      let initialState = () => Config.default;
      let reduce = (action, _prevState) => {
        switch (action) {
        | SetRoute(nextRoute) => nextRoute
        };
      };
      let equals = (==);
    });

  let useRoute = () => {
    let%hook (route, dispatch) = RouterState.useState();
    let setRoute = route => dispatch(SetRoute(route));
    (route, setRoute);
  };
};

let x = 42;
