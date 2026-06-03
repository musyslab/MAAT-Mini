import React from "react"
import { Link } from "react-router-dom"
import "../../styling/Directory.scss"

export type DirectoryCrumb = {
    label: string
    to?: string
    onClick?: () => void
}

interface DirectoryBreadcrumbsProps {
    items: DirectoryCrumb[]
    trailingSeparator?: boolean // true => "Class Selection/"
    className?: string
    confirmOnNavigate?: boolean
    confirmMessage?: string
}

const DirectoryBreadcrumbs: React.FC<DirectoryBreadcrumbsProps> = ({
    items,
    trailingSeparator = false,
    className = "",
    confirmOnNavigate = false,
    confirmMessage = "You have unsaved changes. Leave this page?",
}) => {
    const shouldNavigate = () => {
        if (!confirmOnNavigate) return true
        return window.confirm(confirmMessage)
    }

    const handleCrumbClick = (e: React.MouseEvent, onClick?: () => void) => {
        if (!shouldNavigate()) {
            e.preventDefault()
            return
        }

        onClick?.()
    }

    return (
        <nav className={`directory ${className}`.trim()} aria-label="Directory">
            <ol className="directory__list">
                {items.map((item, idx) => {
                    const isLast = idx === items.length - 1
                    const showSeparator = !isLast || trailingSeparator

                    const content =
                        item.to ? (
                            <Link
                                className="directory__link"
                                to={item.to}
                                onClick={(e) => handleCrumbClick(e, item.onClick)}
                            >
                                {item.label}
                            </Link>
                        ) : item.onClick ? (
                            <button
                                type="button"
                                className="directory__link"
                                onClick={(e) => handleCrumbClick(e, item.onClick)}
                            >
                                {item.label}
                            </button>
                        ) : (
                            <span className="directory__current">{item.label}</span>
                        )

                    return (
                        <li key={`${item.label}-${idx}`} className="directory__item">
                            {content}
                            {showSeparator && <span className="directory__sep">/</span>}
                        </li>
                    )
                })}
            </ol>
        </nav>
    )
}

export default DirectoryBreadcrumbs