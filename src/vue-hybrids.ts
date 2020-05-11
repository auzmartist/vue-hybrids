import Vue from 'vue'
import {render, html, property, Hybrids, define as hybridDefine, dispatch} from 'hybrids'
import {injectHook, toVNodes} from './utils'

interface ComponentDefn {
	name: string
	props?: string[] | Record<string, Prop>
	[key: string]: any
}

interface Prop {
	type?: Function,
	required?: Boolean,
	default?: any,
	[key: string]: any
}

export interface CustomElement extends HTMLElement {
	debugVueHybrid: Boolean
	_propKeys?: string[]
	[key: string]: any
}

export interface VueElement extends HTMLElement {
	__vue__: any
}

function extractProps(propsDefn: string[] | Record<string, Prop>) {
	const props = {}
	if(Array.isArray(propsDefn)) {
		propsDefn.forEach((key) => {
			props[key] = property(null)
		})
	} else if(typeof propsDefn === 'object') {
		Object.entries(propsDefn).forEach(([key, value]) => {
			if(value.type && value.type === Function) {
				props[key] = property(value.default != null ? () => value.default : (v) => v)
			} else {
				props[key] = property(value.default != null ? value.default : value.type ? value.type() : null)
			}
		})
	}
	return props
}

/**
 * Copies child components into slots
 * 'this' is the observed host node
 * @param component the component to which slotted content are assigned
 */
function assignSlotChildren(component) {
	component.slotChildren = Object.freeze(toVNodes(component.$createElement, this.childNodes))
}

function mapPropsFromHost(host) {
	const propsData = {}
	host._propKeys?.forEach((key) => propsData[key] = host[key])
	return propsData
}

function vueify(defn: ComponentDefn, shadowStyles?: string[]) {

	/* proxy $emit to host DOM element */
	injectHook(defn, 'beforeCreate', function() {
		const emit = this.$emit
		this.$emit = (name, ...detail) => {
			dispatch(this.$root.$options.customElement, name, {
				detail: detail.length === 0 ? null : detail.length === 1 ? detail[0] : detail,
				bubbles: true,
				composed: true,
			})
			return emit.call(this, name, ...detail)
		}
	})

	return render((host: CustomElement) => {
		/* Must take place in the render function so that hybrids will re-render on cache access */
		const props = mapPropsFromHost(host)

		return (host: CustomElement, target: HTMLElement | ShadowRoot | Text) => {
			const wrapper = new Vue({
				name: 'shadow-root',
				customElement: host, // dispatch host for proxied events
				shadowRoot: target,
				data: () => ({props, slotChildren: []}),
				render(h) {
					return h(defn, {
						ref: 'inner',
						props: this.props,
						attrs: {'data-vh': defn.name},
					}, this.slotChildren)
				},
			} as any)

			/* observe and assign slot content */
			const observer = new MutationObserver(() => assignSlotChildren.call(host, wrapper))
			observer.observe(host, {childList: true, subtree: true, characterData: true, attributes: true})
			assignSlotChildren.call(host, wrapper)

			/* mount the shadow root wrapper */
			wrapper.$mount()

			const prev = (target as any).querySelector(`[data-vh='${defn.name}']`)
			if(prev) {
				target.replaceChild(wrapper.$el, prev)
			} else {
				target.appendChild(wrapper.$el)
			}

			/* Add shadow DOM styling */
			shadowStyles && html`
				${host.debugVueHybrid && host._propKeys.map((key) => html`
					<span><b>${key}</b> (${typeof host[key]}): ${JSON.stringify(host[key])}</span> <br/>
				`)}
			`.style(...shadowStyles)(host, target)
		}
	})
}

export function wrap(defn: ComponentDefn, shadowStyles?: string[]): Hybrids<CustomElement> {
	if(!defn.name) {
		throw new Error(`[vue-hybrids] wrapped component requires a 'name' property.`)
	}

	let props = {}

	/* map traditional props */
	if(defn.props) {
		props = {...props, ...extractProps(defn.props) }
	}

	/* map props from all mixins */
	if(defn.mixins) {
		defn.mixins.forEach((m) => props = {...props, ...extractProps(m.props)})
	}

	/* map props from extended components */
	if(defn.extend && defn.extend.props) {
		props = {...props, ...extractProps(defn.extend.props)}
	}

	return {
		debugVueHybrid: false,
		_propKeys: Object.keys(props),
		...props,
		name: defn.name,
		version: defn.version,
		render: vueify(defn, shadowStyles),
	} as Hybrids<CustomElement>
}

export function define(defn: ComponentDefn, ...shadowStyles: string[]): ComponentDefn {
	hybridDefine(defn.name, wrap(defn, shadowStyles))
	return defn
}