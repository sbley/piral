import { WrappedComponent, Dict, BaseComponentProps, AnyComponent, BaseRegistration } from 'piral-core';
import { ComponentType } from 'react';

declare module 'piral-core/lib/types/custom' {
  interface PiletCustomApi extends PiletMenuApi {}

  interface PiralCustomState {}

  interface PiralCustomActions {
    /**
     * Registers a new menu item.
     * @param name The name of the menu item.
     * @param value The menu registration.
     */
    registerMenuItem(name: string, value: MenuItemRegistration): void;
    /**
     * Unregisters an existing menu item.
     * @param name The name of the menu item to be removed.
     */
    unregisterMenuItem(name: string): void;
  }

  interface PiralCustomRegistryState {
    /**
     * The registered menu items for global display.
     */
    menuItems: Dict<MenuItemRegistration>;
  }

  interface PiralCustomErrors {
    menu: MenuItemErrorInfoProps;
  }

  interface PiralCustomComponentsState {
    /**
     * The menu container component.
     */
    MenuContainer: ComponentType<MenuContainerProps>;
    /**
     * The menu item component.
     */
    MenuItem: ComponentType<MenuItemProps>;
  }
}

export interface MenuProps {
  /**
   * The type of the menu.
   */
  type: MenuType;
}

export interface MenuContainerProps {
  /**
   * The type of the menu.
   */
  type: MenuType;
}

export interface MenuItemProps {
  /**
   * The type of the menu.
   */
  type: MenuType;
}

/**
 * The error used when a registered menu item component crashed.
 */
export interface MenuItemErrorInfoProps {
  /**
   * The type of the error.
   */
  type: 'menu';
  /**
   * The provided error details.
   */
  error: any;
  /**
   * The type of the used menu.
   */
  menu: MenuType;
}

export interface MenuComponentProps extends BaseComponentProps {}

export interface MenuSettings {
  /**
   * Sets the type of the menu to attach to.
   * @default "general"
   */
  type?: MenuType;
}

export type MenuType = 'general' | 'admin' | 'user' | 'header' | 'footer';

export interface MenuItemRegistration extends BaseRegistration {
  component: WrappedComponent<MenuComponentProps>;
  settings: MenuSettings;
}

export interface PiletMenuApi {
  /**
   * Registers a menu item for a predefined menu component.
   * The name has to be unique within the current pilet.
   * @param name The name of the menu item.
   * @param Component The component to be rendered within the menu.
   * @param settings The optional configuration for the menu item.
   */
  registerMenu(name: string, Component: AnyComponent<MenuComponentProps>, settings?: MenuSettings): void;
  /**
   * Registers a menu item for a predefined menu component.
   * @param Component The component to be rendered within the menu.
   * @param settings The optional configuration for the menu item.
   */
  registerMenu(Component: AnyComponent<MenuComponentProps>, settings?: MenuSettings): void;
  /**
   * Unregisters a menu item known by the given name.
   * Only previously registered menu items can be unregistered.
   * @param name The name of the menu item to unregister.
   */
  unregisterMenu(name: string): void;
}
